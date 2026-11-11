#!/usr/bin/env node
/** Neo Core's single Markcut MCP wrapper. Generic stdio proxy + Neo-owned
 * review handoff/notification; no Swift changes or middleware registry.
 */
import {spawn,execFile,execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
import {existsSync,readFileSync,writeFileSync,renameSync,statSync,unlinkSync,mkdirSync,readdirSync,realpathSync} from 'node:fs';
import {join,basename,resolve,dirname,relative,isAbsolute,sep} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {startStdioProxy} from './stdio-proxy.mjs';
import {commitRunPreview} from '../../.bin/neo-run-git.mjs';
// Neo owns orchestration; Neo.app owns the durable Review REST service.
// All review operations use HTTP REST, never the Agent MCP Tool surface.
export function reviewNotifyURL({portFile=join(homedir(),'Library','Application Support','NeoY','deployment.json'),
  override=process.env.NEO_REVIEW_NOTIFY_URL}={}){
  if(override){
    const url=new URL(override);
    if(url.protocol!=='http:'||!['127.0.0.1','localhost'].includes(url.hostname)||
       url.pathname!=='/mobile/review/notify'||url.username||url.password||url.search||url.hash)
      throw Error('Neo Review notify URL must be a loopback HTTP REST endpoint');
    return url.href;
  }
  let port=6767;
  if(existsSync(portFile)){
    const settings=JSON.parse(readFileSync(portFile,'utf8'));
    if(Number.isInteger(settings.mcpPort)&&settings.mcpPort>=1&&settings.mcpPort<=65535)
      port=settings.mcpPort;
  }
  return `http://127.0.0.1:${port}/mobile/review/notify`;
}
export async function notifyReview(request,{fetchImpl=fetch,url=reviewNotifyURL()}={}){
  const destination=new URL(url);
  if(destination.protocol!=='http:'||!['127.0.0.1','localhost'].includes(destination.hostname)||
     destination.pathname!=='/mobile/review/notify'||destination.search||destination.hash||
     destination.username||destination.password)
    throw Error('Neo Core notify only accepts localhost REST');
  const response=await fetchImpl(destination.href,{
    method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},
    body:JSON.stringify(request),signal:AbortSignal.timeout(55000),redirect:'error'
  });
  if(!response.ok)throw Error(`Neo.app Review REST notify failed: HTTP ${response.status}`);
  const receipt=await response.json();
  if(receipt?.stored!==true||receipt?.requestId!==request.id)
    throw Error('Neo.app Review REST did not confirm durable Inbox storage');
  return receipt;
}

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertBoundReceipt(receipt,relay){
  const fixed=receipt?.eventTemplate?.data?.interactive;
  if(!UUID.test(receipt?.invocationId||'')||
    receipt.jobId!==relay.jobId||String(receipt.taskId)!==String(relay.taskId)||
    receipt.executionId!==relay.executionId||
    fixed?.jobId!==relay.jobId||String(fixed?.taskId)!==String(relay.taskId)||
    fixed?.executionId!==relay.executionId||fixed?.invocationId!==receipt.invocationId)
    throw Error('Invalid Relay interactive begin receipt');
  return {jobId:receipt.jobId,taskId:String(receipt.taskId),
    executionId:receipt.executionId,invocationId:receipt.invocationId};
}
export function operationIdFromResult(result){
  if(result?.isError===true)return null;
  const id=result?.structuredContent?.operationId;
  return typeof id==='string'&&UUID.test(id)?id:null;
}
function watcher(id){
  const program=fileURLToPath(new URL('./markcut.mjs',import.meta.url));
  const child=spawn(process.execPath,[program,'watch',id],{detached:true,stdio:'ignore',env:process.env});
  child.on('error',error=>{process.stderr.write('Neo Preview watcher: '+error.message+'\n');});
  child.unref();
}
/** A Relay review must bind a committed Run revision, not Markcut's media hash.
 * Neo's federated markcut_preview schema does not expose review.commitSha.
 * Resolve it deterministically from the checked-in Markdown source, before
 * reserving any Relay invocation; an uncommitted edit must fail closed.
 */
export function commitShaForPreview(previewPath,{git=execFileSync}={}){
  if(typeof previewPath!=='string'||!isAbsolute(previewPath)||!previewPath.endsWith('.md'))
    throw Error('Event Preview requires an absolute committed Markdown path');
  const file=realpathSync(previewPath);
  if(!statSync(file).isFile())throw Error('Event Preview source is not a regular file');
  const options={cwd:dirname(file),encoding:'utf8',timeout:8000,maxBuffer:1024*1024};
  const call=(...args)=>String(git('git',args,options)).trim();
  let root,sha;
  try {root=realpathSync(call('rev-parse','--show-toplevel')); sha=call('rev-parse','--verify','HEAD^{commit}');}
  catch {throw Error('Event Preview needs a valid committed Run Git revision; checkpoint the Stage first');}
  const rel=relative(root,file);
  if(!rel||rel==='..'||rel.startsWith(`..${sep}`)||isAbsolute(rel)||!/^[a-f0-9]{40}$/.test(sha))
    throw Error('Event Preview is outside its committed Run or has an invalid Git SHA');
  try {call('cat-file','-e',`HEAD:${rel}`);}
  catch {throw Error('Event Preview Markdown must be tracked in the Run checkpoint before delivery');}
  if(call('status','--porcelain=v1','--untracked-files=normal','--',rel))
    throw Error('Event Preview Markdown differs from the immutable Run checkpoint; commit the Stage first');
  return sha;
}

/** Called only for markcut.preview. All other MCP methods are transparent. */
export async function previewCall(message,forward,{control=relayControl,notifyWatcher=watcher,record=recordDeliveryIntent}={}){
  const params=message.params||{};
  const input=params.arguments||{};
  const relay=input.relay;
  let binding=null;
  let forwarded=message;
  if(relay!==undefined&&relay!==null){
    if(!relay||typeof relay!=='object'||typeof relay.jobId!=='string'||!relay.jobId||
      !(typeof relay.taskId==='string'&&relay.taskId.length||Number.isSafeInteger(relay.taskId))||
      typeof relay.executionId!=='string'||!relay.executionId)
      throw Error('Managed preview requires relay.jobId, taskId and executionId');
    // A missing commitSha is normal for the public Neo tool schema; do not
    // reserve a Relay invocation or submit an invalid Markcut request for it.
    // Bound Project Runs checkpoint every nonignored change before reserving the review.
    // For non-Run Git sources, keep the existing read-only committed-SHA path.
    const runMarker = (() => {
      try { const run=execFileSync('git',['-C',dirname(realpathSync(input.path)),'rev-parse','--show-toplevel'],{encoding:'utf8',timeout:8000}).trim();
        return existsSync(join(run,'.neo-project-run.json')); } catch { return false; }
    })();
    const commitSha=runMarker ? commitRunPreview(input.path).commitSha : (input.review?.commitSha??commitShaForPreview(input.path));
    if (runMarker && input.review?.commitSha && input.review.commitSha!==commitSha) throw Error('Explicit Preview revision does not match current committed Run');
    if(!/^[a-f0-9]{40}$/.test(commitSha))throw Error('Event Preview requires a full Git Commit SHA');
    const receipt=await control('review.interactive.begin',{
      jobId:relay.jobId,taskId:String(relay.taskId),executionId:relay.executionId});
    binding=assertBoundReceipt(receipt,{...relay,taskId:String(relay.taskId)});
    if(receipt.reused===true)
      throw Error('Preview already requested for this execution; do not start another compile');
    forwarded={...message,params:{...params,arguments:{...input,
      review:{delivery:'event',commitSha,eventTemplate:receipt.eventTemplate}}}};
  }
  let result;
  try{result=await forward(forwarded);}
  catch(error){
    if(binding)await control('review.interactive.abort',binding);
    throw error;
  }
  const operationId=operationIdFromResult(result);
  if(!operationId){
    if(binding)await control('review.interactive.abort',binding);
    return result;
  }
  try{
    record(operationId,binding);
    notifyWatcher(operationId); // standalone also receives optional view-only iPhone preview
    if(binding)await control('review.interactive.wait',binding);
  }catch(error){
    if(binding){
      try{await control('review.interactive.abort',binding);}catch{}
    }
    throw error;
  }
  return result;
}

/** Paste the generated record into Neo.app's existing MCP Federation config. */
export function federationConfiguration({node=existsSync('/opt/homebrew/bin/node')?'/opt/homebrew/bin/node':process.execPath,upstream,wrapper=fileURLToPath(import.meta.url)}={}){
  if(!upstream?.startsWith('/')||!node.startsWith('/')||!wrapper.startsWith('/'))
    throw Error('Federation requires absolute node, wrapper, and upstream paths');
  const query=new URLSearchParams([['arg',wrapper],['arg',upstream]]);
  return {name:'markcut',url:`stdio://${node}?${query}`,isEnabled:true};
}

export function startMarkcutWrapper(upstream,options={}){
  if(typeof upstream!=='string'||!upstream.startsWith('/'))throw Error('Expected absolute upstream MCP executable');
  if(pendingDeliveryIds().length){
    const program=fileURLToPath(new URL('./markcut.mjs',import.meta.url));
    const child=spawn(process.execPath,[program,'recover'],{detached:true,stdio:'ignore',env:process.env});
    child.on('error',error=>{process.stderr.write('Neo Preview recovery: '+error.message+'\n');});
    child.unref();
  }
  return startStdioProxy({command:upstream,args:options.args||[],toolName:'markcut.preview',
    description:'Neo-hosted Markcut video preview. Call once with path and optional relay {jobId,taskId,executionId}. Neo handles Relay interaction and iPhone notification; standalone is supported.',
    wrapCall:(message,forward)=>previewCall(message,forward)});
}

const HASH=/^[a-f0-9]{64}$/;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
/** Wrapper calls the stable Relay CLI, never a private HTTP endpoint. */
const runFile=promisify(execFile);
export function relayInteractiveArgs(command,fields){
  const action=command.replace(/^review\.interactive\./,'');
  if(!['begin','wait','ready','fail','abort'].includes(action)||command!==`review.interactive.${action}`)
    throw Error('Unsupported Relay review action');
  const args=['review','interactive',action,'--id',String(fields.jobId),
    '--task-id',String(fields.taskId),'--execution-id',String(fields.executionId)];
  if(action!=='begin')args.push('--invocation-id',String(fields.invocationId));
  if(action==='ready')args.push('--revision',String(fields.revision));
  if(action==='fail')args.push('--reason',String(fields.reason));
  return args;
}
export async function relayControl(command,fields,{exec=runFile}={}){
  const binary=process.env.NEOY_RELAY_CLI||'/opt/homebrew/bin/agents-relay';
  const args=relayInteractiveArgs(command,fields);
  try{
    const {stdout}=await exec(binary,args,{timeout:15000,maxBuffer:1024*1024});
    return JSON.parse(stdout);
  }catch(error){
    throw Error('Agents Relay CLI '+command+' failed: '+String(error?.stderr||error?.message||error).slice(0,350));
  }
}
function relayIdentity(operation){
  const relay=operation?.result?.relay||operation?.relay;
  const fixed=(operation?.result?.review||operation?.review)?.eventTemplate?.data?.interactive;
  if(!relay)return null;
  if(!fixed||!fixed.jobId||!fixed.taskId||!fixed.executionId||!fixed.invocationId||
    relay.jobId!==fixed.jobId||String(relay.taskId)!==fixed.taskId||relay.executionId!==fixed.executionId)
    throw new Error('Relay preview identity differs from bound template');
  return {jobId:fixed.jobId,taskId:fixed.taskId,executionId:fixed.executionId,
    invocationId:fixed.invocationId};
}
export const operationsDirectory=()=>process.env.NEOY_MARKCUT_OPERATIONS_DIR ||
  join(homedir(),'Library','Application Support','NeoY','exports','_neoy','markcut','operations');
export const deliveryDirectory=()=>process.env.NEOY_PREVIEW_DELIVERY_DIR ||
  join(homedir(),'Library','Application Support','NeoY','apns','preview-requests');
function deliveryRecord(id,directory){if(!UUID.test(id))throw new Error('Invalid operation ID');return join(directory,id+'.json');}
/** Creates a durable Neo-only delivery intent before Relay suspends the Worker. */
export function recordDeliveryIntent(id,binding=null,dir=deliveryDirectory()){
  const file=deliveryRecord(id,dir);
  mkdirSync(dir,{recursive:true,mode:0o700});
  const value={operationId:id,status:'pending',...(binding?{binding}:{}),createdAt:new Date().toISOString()};
  try{writeFileSync(file,JSON.stringify(value),{flag:'wx',mode:0o600});}
  catch(error){
    if(error.code!=='EEXIST')throw error;
    const previous=JSON.parse(readFileSync(file,'utf8'));
    if(previous.operationId!==id||JSON.stringify(previous.binding||null)!==JSON.stringify(binding||null))
      throw Error('Conflicting Neo review intent for operation '+id);
  }
  return file;
}
export function pendingDeliveryIds(dir=deliveryDirectory()){
  let names=[];try{names=readdirSync(dir);}catch(error){if(error.code!=='ENOENT')throw error;}
  return names.filter(name=>UUID.test(name.slice(0,-5))&&name.endsWith('.json')).flatMap(name=>{
    try{const value=JSON.parse(readFileSync(join(dir,name),'utf8'));
      return value.status==='pending'&&value.operationId===name.slice(0,-5)?[value.operationId]:[];
    }catch{return [];}
  });
}
function persistDelivery(path,value){
  const tmp=path+'.'+process.pid+'.tmp';
  writeFileSync(tmp,JSON.stringify(value),{mode:0o600});renameSync(tmp,path);
}
function acquireDeliveryLock(path){
  const lock=path+'.lock';
  for(let attempt=0;attempt<2;attempt++){
    try{writeFileSync(lock,JSON.stringify({pid:process.pid}),{flag:'wx',mode:0o600});return lock;}
    catch(error){
      if(error.code!=='EEXIST')throw error;
      let alive=false;
      try{const pid=JSON.parse(readFileSync(lock,'utf8')).pid;
        if(Number.isSafeInteger(pid)&&pid>0){process.kill(pid,0);alive=true;}
      }catch{}
      let recent=false;try{recent=Date.now()-statSync(lock).mtimeMs<600000;}catch{}
      if(alive&&recent)return null;
      try{unlinkSync(lock);}catch{}
    }
  }
  throw new Error('Cannot acquire delivery lock');
}

export function buildNeoReviewRequest(operationId,operation){
  if(!UUID.test(operationId)||operation?.state!=='ready'||!operation.result)
    throw new Error('Preview is not ready');
  const result=operation.result;
  if(!HASH.test(result.contentHash||'')||typeof result.revisionId!=='string'||!result.revisionId||
     typeof result.id!=='string'||!result.id)throw new Error('Invalid immutable preview identity');
  const review=result.review||{delivery:'text'};
  const request={id:operationId,previewId:result.id,title:basename(operation.requestedPath||result.requestedPath||'video.md','.md'),
    delivery:review.delivery||'text'};
  if(request.delivery==='event'){
    if(!/^[a-f0-9]{40}$/.test(review.commitSha||''))throw new Error('Event review requires full Git Commit SHA');
    request.commitSha=review.commitSha;
    request.mediaHash=result.contentHash;
    if(!review.eventTemplate)throw new Error('Event review requires caller-bound template');
    request.eventTemplate=review.eventTemplate;
    const fixed=review.eventTemplate?.data?.interactive;
    if(!fixed?.jobId||!fixed.taskId||!fixed.executionId||!fixed.invocationId)
      throw new Error('Invalid bound interactive review');
    request.jobId=fixed.jobId;
    request.groupId=`job/${fixed.jobId}/task/${fixed.taskId}`;
  } else if(request.delivery==='text'){
    request.contentHash=result.contentHash;request.revisionId=result.revisionId;
    request.groupId=operation.requestedPath||result.requestedPath;
  } else throw new Error('Unknown delivery');
  return request;
}

/** Delivery is never attempted for failed or unfinished revisions. */
export async function watchAndNotify(operationId,{directory=operationsDirectory(),deadlineMs=600000,
  intervalMs=350,notify=notifyReview,onFailed, onReady, initialIdentity=null}={}){
  if(!UUID.test(operationId))throw new Error('Invalid operation ID');
  const path=join(directory,operationId+'.json');
  let identity=initialIdentity;
  const fail=async(reason)=>{
    if(onFailed)await onFailed(reason);
    else if(identity)await relayControl('review.interactive.fail',{...identity,reason});
  };
  const deadline=Date.now()+deadlineMs;
  while(Date.now()<deadline){
    let operation;
    try{operation=JSON.parse(readFileSync(path,'utf8'));}
    catch(error){if(error?.code!=='ENOENT')throw error;}
    if(operation?.state==='failed'){
      identity=relayIdentity(operation)||identity;
      await fail(operation.error||'Preview compilation failed');
      return {notified:false,failed:true,error:operation.error||'Preview compilation failed'};
    }
    if(operation?.state==='ready'){
      identity=relayIdentity(operation)||identity;
      const request=buildNeoReviewRequest(operationId,operation);
      if(identity){
        try{
          const ready=onReady||((revision)=>relayControl('review.interactive.ready',{
            ...identity,revision}));
          // The Worker may still be returning from tools/call when compilation
          // finishes. Wait for Relay waiting transition before binding hash.
          for(let attempt=0;;attempt++){
            try{await ready(request.commitSha);break;}
            catch(error){if(attempt>=19)throw error;await delay(250);}
          }
        }catch(error){
          await fail('Relay preview revision binding failed: '+String(error?.message||error));
          throw error;
        }
      }
      try{
        const receipt=await notify(request);
        if(receipt?.stored!==true)throw new Error('Neo review inbox persistence was not acknowledged');
        return {notified:true,requestId:request.id,receipt};
      }catch(error){
        // Fail closed: no confirmed inbox request, so requeue the Task.
        const reason='Neo review delivery failed: '+String(error?.message||error);
        await fail(reason);
        return {notified:false,failed:true,error:reason};
      }
    }
    await delay(intervalMs);
  }
  await fail('Preview operation timed out');
  throw new Error('Preview operation timed out');
}

/** The Neo-owned intent is durable and replayable after a native-app restart. */
export async function runRecordedDelivery(id,{recordDir=deliveryDirectory(),directory=operationsDirectory(),
  notify=notifyReview,onReady,onFailed}={}){
  const file=deliveryRecord(id,recordDir);
  const record=JSON.parse(readFileSync(file,'utf8'));
  if(record.operationId!==id)throw new Error('Mismatched Neo delivery intent');
  if(record.status==='delivered'||record.status==='failed')return {skipped:true,status:record.status};
  if(record.status!=='pending')throw new Error('Invalid Neo delivery status');
  const lock=acquireDeliveryLock(file);
  if(!lock)return {alreadyRunning:true};
  try{
    const result=await watchAndNotify(id,{directory,notify,onReady,onFailed,initialIdentity:record.binding||null});
    persistDelivery(file,{...record,status:result.notified?'delivered':'failed',updatedAt:new Date().toISOString(),
      ...(result.error?{error:result.error}:{})});
    return result;
  }catch(error){
    persistDelivery(file,{...record,status:'pending',lastError:String(error?.message||error).slice(0,300),
      updatedAt:new Date().toISOString()});
    throw error;
  }finally{try{unlinkSync(lock);}catch{}}
}

/** Recover all pending intents with bounded parallelism, not a capped subset. */
export async function recoverPendingDeliveries({recordDir=deliveryDirectory(),directory=operationsDirectory(),
  concurrency=3,notify=notifyReview,onReady,onFailed}={}){
  const ids=pendingDeliveryIds(recordDir);
  let next=0,delivered=0,failed=0,skipped=0;
  async function worker(){
    while(next<ids.length){
      const id=ids[next++];
      try{
        const result=await runRecordedDelivery(id,{recordDir,directory,notify,onReady,onFailed});
        if(result.notified)delivered++;
        else if(result.failed)failed++;
        else skipped++;
      }catch(error){
        failed++;
        process.stderr.write(`Neo review recovery ${id}: ${String(error.message||error)}\n`);
      }
    }
  }
  await Promise.all(Array.from({length:Math.min(Math.max(1,concurrency),ids.length)},worker));
  return {pending:ids.length,delivered,failed,skipped};
}


if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv[2]==='--federation'){
    const upstream=process.argv[3]||process.env.NEO_MARKCUT_MCP_SERVER;
    process.stdout.write(JSON.stringify(federationConfiguration({upstream}),null,2)+'\n');
  }else if(process.argv[2]==='watch'&&process.argv[3]){
    runRecordedDelivery(process.argv[3]).then(result=>{
      process.stdout.write(JSON.stringify(result)+'\n');
      if(!result.notified&&!result.skipped&&!result.alreadyRunning)process.exitCode=1;
    }).catch(error=>{process.stderr.write('Neo review delivery: '+String(error.message||error)+'\n');process.exitCode=1;});
  }else if(process.argv[2]==='recover'){
    recoverPendingDeliveries().then(result=>{
      process.stdout.write(JSON.stringify(result)+'\n');
      if(result.failed)process.exitCode=1;
    }).catch(error=>{process.stderr.write('Neo review recovery: '+String(error.message||error)+'\n');process.exitCode=1;});
  }else{
    const upstream=process.argv[2]||process.env.NEO_MARKCUT_MCP_SERVER;
    startMarkcutWrapper(upstream,{args:process.argv.slice(3)});
  }
}
