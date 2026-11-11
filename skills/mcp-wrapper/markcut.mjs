#!/usr/bin/env node
/** Neo Core's single Markcut MCP wrapper. Generic stdio proxy + Neo-owned
 * review handoff/notification; no Swift changes or middleware registry.
 */
import {spawn,execFile,execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {promisify} from 'node:util';
import {existsSync,readFileSync,writeFileSync,renameSync,statSync,unlinkSync,mkdirSync,readdirSync,realpathSync} from 'node:fs';
import {join,basename,resolve,dirname,relative,isAbsolute,sep,extname} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {startStdioProxy} from './stdio-proxy.mjs';
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

function validateRelayReviewTemplate(template,relay){
  const fixed=template?.data?.interactive;
  const source=`job/${relay.jobId}/task/${relay.taskId}/execution/${relay.executionId}`;
  if(template?.type!=='task.interactive_decision'||template.source!==source||
    !fixed||fixed.jobId!==relay.jobId||String(fixed.taskId)!==String(relay.taskId)||
    fixed.executionId!==relay.executionId||
    ['decision','feedback','comments','revision','revisionId','contentHash','commitSha','invocationId','previewId','requestId','idempotencyKey']
      .some(key=>Object.hasOwn(fixed,key)))throw Error('Invalid Relay review event template');
  return {...template,responseKey:'interactive'};
}
function assertBoundReceipt(receipt,relay){
  if(receipt?.jobId!==relay.jobId||String(receipt?.taskId)!==String(relay.taskId)||
    receipt?.executionId!==relay.executionId)throw Error('Invalid Relay interactive begin receipt');
  validateRelayReviewTemplate(receipt.eventTemplate,relay);
  return {jobId:receipt.jobId,taskId:String(receipt.taskId),executionId:receipt.executionId};
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

/** Adapt a single local media file to the native Markdown-only Preview Tool.
 * The ghost file is deliberately stable per media directory and is ignored by
 * Run Git. The original Markdown preview and review protocol are untouched.
 */
const MEDIA_TYPES=new Map([
  ...['.mp4','.mov','.m4v','.webm'].map(ext=>[ext,'video']),
  ...['.png','.jpg','.jpeg','.webp','.gif'].map(ext=>[ext,'image']),
  ...['.mp3','.wav','.m4a','.aac','.flac','.ogg'].map(ext=>[ext,'audio']),
]);
export function singleMediaPreviewPath(path,{probe=execFileSync}={}){
  if(typeof path!=='string'||!isAbsolute(path))return path;
  const type=MEDIA_TYPES.get(extname(path).toLowerCase());
  if(!type)return path;
  const file=realpathSync(path);
  if(!statSync(file).isFile())throw Error('Preview media source must be a regular file');
  const metadata=JSON.parse(String(probe('ffprobe',['-v','error','-select_streams','v:0',
    '-show_entries','stream=width,height:format=duration','-of','json',file],
    {encoding:'utf8',timeout:15000,maxBuffer:16384})));
  const duration=type==='image'?5:Number(metadata.format?.duration);
  if(!Number.isFinite(duration)||duration<=0)throw Error('Unable to read preview media duration: '+file);
  const visual=metadata.streams?.[0];
  if(type!=='audio' && (!Number.isInteger(visual?.width)||!Number.isInteger(visual?.height)||
    visual.width<=0||visual.height<=0))throw Error('Unable to read preview media dimensions: '+file);
  const scale=type==='audio'?1:Math.min(1,1280/Math.max(visual.width,visual.height));
  const width=type==='audio'?1280:Math.max(2,Math.round(visual.width*scale/2)*2);
  const height=type==='audio'?720:Math.max(2,Math.round(visual.height*scale/2)*2);
  const output=join(dirname(file),'.ghost.markcut.md');
  const body='# video\nwidth:'+width+' height:'+height+' fps:30 layout:series\n## Media\nlayout:parallel\n- '+type+
    ' src:'+JSON.stringify(file)+' duration:'+duration.toFixed(3)+'\n';
  if(!existsSync(output)||readFileSync(output,'utf8')!==body){
    const temp=join(dirname(file),'.ghost.markcut.'+randomUUID()+'.tmp');
    try{writeFileSync(temp,body,{flag:'wx',mode:0o600});renameSync(temp,output);}
    finally{if(existsSync(temp))unlinkSync(temp);}
  }
  return output;
}

/** Called only for markcut.preview. All other MCP methods are transparent. */
export async function previewCall(message,forward,{control=relayControl,notifyWatcher=watcher,record=recordDeliveryIntent,resolveMedia=singleMediaPreviewPath}={}){
  const params=message.params||{};
  const input=params.arguments||{};
  if(input.relay!==undefined)throw Error('Use review.relay instead of top-level relay');
  const relay=input.review?.relay;
  const markdownPath=resolveMedia(input.path);
  const prepared=markdownPath===input.path ? message :
    {...message,params:{...params,arguments:{...input,path:markdownPath}}};
  if(input.readonly===true){
    // Read-only playback cannot create a checkpoint, Relay invocation, Inbox
    // item, or watcher. The provider owns compilation and the view-only UI.
    if(input.review!==undefined)
      throw Error('Read-only preview cannot request Relay or review delivery');
    return forward(prepared);
  }
  let binding=null;
  let forwarded=prepared;
  if(relay!==undefined&&relay!==null){
    if(input.review?.commitSha!==undefined || input.review?.invocationId!==undefined)
      throw Error('Managed review is execution-bound; Git SHA and invocation are not accepted');
    if(!relay||typeof relay!=='object'||typeof relay.jobId!=='string'||!relay.jobId||
      !(typeof relay.taskId==='string'&&relay.taskId.length||Number.isSafeInteger(relay.taskId))||
      typeof relay.executionId!=='string'||!relay.executionId)
      throw Error('Managed preview requires relay.jobId, taskId and executionId');
    const receipt=await control('review.interactive.begin',{
      jobId:relay.jobId,taskId:String(relay.taskId),executionId:relay.executionId});
    binding=assertBoundReceipt(receipt,{...relay,taskId:String(relay.taskId)});
    if(receipt.reused===true)
      throw Error('Preview already requested for this execution; do not start another compile');
    forwarded={...prepared,params:{...params,arguments:{...prepared.params.arguments,
      review:{delivery:'event',eventTemplate:validateRelayReviewTemplate(receipt.eventTemplate,binding)}}}};
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
    // Persist the wait before a notification can reach a fast human reviewer.
    if(binding)await control('review.interactive.wait',binding);
    notifyWatcher(operationId); // standalone also receives optional view-only iPhone preview
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
    description:'Neo-hosted generic Markcut preview. Neo Wrapper handles Relay review binding; Markcut only compiles and delivers caller-supplied event templates.',
    aliasName:'review.preview',aliasDescription:'Show a view-only media preview or request human review for the current Relay Task execution. Called by agents-relay review interactive CLI; never commits Git.',
    aliasInputSchema:{type:'object',additionalProperties:false,required:['path'],properties:{
      path:{type:'string',description:'Absolute Markdown or supported media path'},
      relay:{type:'object',additionalProperties:false,required:['jobId','taskId','executionId'],
        properties:{jobId:{type:'string'},taskId:{anyOf:[{type:'string'},{type:'integer'}]},executionId:{type:'string'}}}
    }},
    transformAlias:(input)=>{
      if(typeof input?.path!=='string'||!isAbsolute(input.path))throw Error('review.preview requires absolute path');
      if(Object.keys(input).some(k=>!['path','relay'].includes(k)))throw Error('review.preview only accepts path and optional Relay context');
      if(input.relay===undefined)return {path:input.path,readonly:true};
      return {path:input.path,review:{relay:input.relay}};
    },
    wrapCall:(message,forward)=>previewCall(message,forward)});
}

const HASH=/^[a-f0-9]{64}$/;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
/** Wrapper calls the stable Relay CLI, never a private HTTP endpoint. */
const runFile=promisify(execFile);
export function relayInteractiveArgs(command,fields){
  const action=command.replace(/^review\.interactive\./,'');
  if(!['begin','wait','fail','abort'].includes(action)||command!==`review.interactive.${action}`)
    throw Error('Unsupported Relay review action');
  const args=['review','interactive',action,'--id',String(fields.jobId),
    '--task-id',String(fields.taskId),'--execution-id',String(fields.executionId)];
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

export function buildNeoReviewRequest(operationId,operation,binding=null){
  if(!UUID.test(operationId)||operation?.state!=='ready'||!operation.result)
    throw new Error('Preview is not ready');
  const result=operation.result;
  if(!HASH.test(result.contentHash||'')||typeof result.revisionId!=='string'||!result.revisionId||
     typeof result.id!=='string'||!result.id)throw new Error('Invalid immutable preview identity');
  const review=result.review||{delivery:'text'};
  const request={id:operationId,previewId:result.id,title:basename(operation.requestedPath||result.requestedPath||'video.md','.md'),
    delivery:review.delivery||'text'};
  if(request.delivery==='event'){
    request.mediaHash=result.contentHash;
    if(!review.eventTemplate)throw new Error('Event review requires caller-bound template');
    request.eventTemplate=review.eventTemplate;
    if(binding){
      // Neo alone owns Relay-specific interpretation; Markcut transports the opaque event.
      validateRelayReviewTemplate(review.eventTemplate,binding);
      if(review.eventTemplate.responseKey!=='interactive')throw Error('Invalid Relay review response binding');
      request.jobId=binding.jobId;
      request.groupId=`job/${binding.jobId}/task/${binding.taskId}`;
    }else request.groupId=operation.requestedPath||result.requestedPath;
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
      await fail(operation.error||'Preview compilation failed');
      return {notified:false,failed:true,error:operation.error||'Preview compilation failed'};
    }
    if(operation?.state==='ready'){
      const request=buildNeoReviewRequest(operationId,operation,identity);
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
