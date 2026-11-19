import {spawn} from 'node:child_process';
import {writeFileSync,mkdirSync,rmSync,readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname,join} from 'node:path';
import {key} from './input.mjs';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const PROJECT_CONFIG=join(homedir(),'.config','neo','models','chatgpt-project.json');
export function configuredProjectId(file=PROJECT_CONFIG){
  let config;
  try{config=JSON.parse(readFileSync(file,'utf8'))}
  catch(e){if(e.code==='ENOENT')return null;throw Error('Invalid Neo model ChatGPT Project config: '+e.message)}
  const id=config?.project_id;
  if(typeof id!=='string'||!/^g-p-[A-Za-z0-9]{32}$/.test(id))throw Error('Invalid Neo model ChatGPT Project ID');
  return id;
}
export class WebHelmTransport {
  constructor({
    binary=join(homedir(),'.local','bin','webhelm'),
    tempDir=join(homedir(),'.local','share','neo','model-gateway','tmp'),
    exec=runCLI,projectId=configuredProjectId(),
    holdSession=process.env.NEO_MODEL_HOLD_CHATGPT_SESSION!=='0',
    platform=process.env.NEO_MODEL_WEBHELM_PLATFORM||'chatgpt',
    appName=process.env.NEO_MODEL_APP_MENTION??'Neo',
    serializeNewThread=process.env.NEO_MODEL_SERIAL_NEW_THREAD!=='0',
  }={}){
    this.binary=binary;this.tempDir=tempDir;this.exec=exec;this.projectId=projectId;this.holdSession=holdSession;this.held=new Map();
    this.platform=platform;
    this.appName=appName;
    this.serializeNewThread=serializeNewThread;
    this.newThreadTail=Promise.resolve();
    mkdirSync(tempDir,{recursive:true,mode:0o700});
  }
  async #run(args){
    const result=await this.exec(this.binary,args);
    if(!result||result.ok===false||result.result?.ok===false)throw Error('WebHelm action failed: '+String(result?.result?.error??result?.error??'unknown error').slice(0,300));
    return result.result?.value??result.result??result;
  }
  async #config(action,config,{autoSession=true,sessionId=null}={}){
    const file=join(this.tempDir,'config-'+key()+'.json');
    writeFileSync(file,JSON.stringify(config),{mode:0o600,flag:'wx'});
    try{return await this.#run(['platform','run',this.platform,action,...(autoSession?['--auto-session']:sessionId?['--session-id',sessionId]:[]),'--config',file]);}
    finally{rmSync(file,{force:true});}
  }
  async #openSession(url){
    const receipt=await this.#run(['session','start','--url',url]);
    if(!/^[a-f0-9]{16}$/.test(receipt?.session_id??''))throw Error('WebHelm session start returned invalid session ID');
    // Model requests use only the shared WebHelm workspace, never a dedicated
    // Neo Models browser Tab Group. Fail closed if the daemon routes elsewhere.
    if(receipt.workspace!=='WebHelm'){
      await this.#closeSession(receipt.session_id);
      throw Error('Model transport requires the default WebHelm workspace');
    }
    return receipt.session_id;
  }
  async #closeSession(id){
    if(!id)return;
    try{await this.#run(['session','stop',id])}
    catch(error){process.stderr.write('[models] WebHelm session cleanup failed: '+error.message+'\n')}
  }
  async newThread(text,enforcement_context='',responseId=null){
    if(!this.serializeNewThread)return this.#submitNewThread(text,enforcement_context,responseId);
    const preceding=this.newThreadTail;
    let release;
    this.newThreadTail=new Promise(resolve=>release=resolve);
    await preceding;
    try{return await this.#submitNewThread(text,enforcement_context,responseId)}
    finally{release()}
  }
  async #submitNewThread(text,enforcement_context='',responseId=null){
    const sessionId=this.holdSession&&responseId?await this.#openSession('https://chatgpt.com/'):null;
    let response;
    try{
      response=await this.#config('new-thread',{
        ...(this.projectId?{project_id:this.projectId}:{}),...(this.appName?{app:this.appName}:{}),message:text,enforcement_context,mode:'chat',temporary:false,
      },{autoSession:!sessionId,sessionId});
    }catch(error){await this.#closeSession(sessionId);throw error}
    try{
      if(response.status!=='submitted'||typeof response.thread_id!=='string'||
          !/^https:\/\/chatgpt\.com\//.test(response.thread_url??''))
        throw Error('new-thread returned no verified submission receipt');
      if(this.projectId && (response.project_id!==this.projectId||
          !new URL(response.thread_url).pathname.includes('/g/'+this.projectId)))
        throw Error('new-thread did not verify the configured ChatGPT Project');
    }catch(error){await this.#closeSession(sessionId);throw error}
    if(sessionId)this.held.set(responseId,{sessionId,lastHeartbeat:Date.now()});
    return response;
  }
  async newTurn(threadId,text,_files=[],idempotencyKey,projectId=null,enforcement_context=''){
    const sessionId=this.holdSession?await this.#openSession('https://chatgpt.com/c/'+encodeURIComponent(threadId)):null;
    let response;
    try{
      response=await this.#config('new-turn',{
        ...(projectId?{project_id:projectId}:{}),...(this.appName?{app:this.appName}:{}),
        thread_id:threadId,message:text,enforcement_context,
        mode:sessionId?'sync':'async',mergeable:false,idempotency_key:idempotencyKey,
      },{autoSession:false,sessionId});
    }catch(error){await this.#closeSession(sessionId);throw error}
    if(sessionId)this.held.set(idempotencyKey,{sessionId,lastHeartbeat:Date.now()});
    if(response.status!=='submitted'||response.thread_id!==threadId||
       !(sessionId?response.verified_by:response.queue_id)){
      this.held.delete(idempotencyKey);await this.#closeSession(sessionId);
      throw Error('new-turn returned no verified submission receipt');
    }
    return response;
  }
  async waitForResult(id,store,{timeoutMs=9*60*1000,maxMs=30*60*1000,pollMs=350}={}){
    const started=Date.now();
    try{
      while(Date.now()-started<maxMs){
        const r=store.response(id);
        if(r?.status==='completed')return (r.output??[]).map(item=>item.content?.[0]?.text??'').join('\n');
        if(r?.status==='failed')throw Error(r.error?.message??'model request failed');
        const lastActivity=Math.max(started,Number(r?.last_activity_at)||0);
        if(Date.now()-lastActivity>=timeoutMs)throw Error('ChatGPT model result not reported before inactivity timeout');
        const held=this.held.get(id);
        if(held&&Date.now()-held.lastHeartbeat>30_000){
          await this.#run(['session','heartbeat',held.sessionId]);
          held.lastHeartbeat=Date.now();
        }
        await sleep(pollMs);
      }
      throw Error('ChatGPT model result not reported before maximum duration');
    }finally{
      const held=this.held.get(id);
      this.held.delete(id);
      if(held)await this.#closeSession(held.sessionId);
    }
  }

}
export async function runCLI(binary,args){
  return new Promise((resolve,reject)=>{
    const child=spawn(binary,args,{env:{...process.env,PATH:[dirname(process.execPath),process.env.PATH??''].join(':')},stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';const timeout=setTimeout(()=>{child.kill('SIGTERM');reject(Error('WebHelm command timeout; submission status uncertain'));},5*60*1000);
    child.stdout.on('data',b=>{stdout+=b;if(stdout.length>2*1024*1024)child.kill('SIGTERM')});
    child.stderr.on('data',b=>{stderr=(stderr+b).slice(-4096)});
    child.once('error',error=>{clearTimeout(timeout);reject(error)});
    child.once('exit',code=>{
      clearTimeout(timeout);
      if(code!==0){
        let detail=stderr.slice(-500);
        try{
          const parsed=JSON.parse(stdout);
          const error=parsed.result?.error??parsed.error??parsed.message;
          if(error)detail=typeof error==='string'?error:JSON.stringify(error);
        }catch{}
        return reject(Error('WebHelm exited '+code+': '+detail.slice(0,600)));
      }
      try{resolve(JSON.parse(stdout))}catch{reject(Error('WebHelm returned invalid JSON'))}
    });
  });
}
