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
  constructor({binary=join(homedir(),'.local','bin','webhelm'),tempDir=join(homedir(),'.local','share','neo','model-gateway','tmp'),exec=runCLI,projectId=configuredProjectId()}={}){
    this.binary=binary;this.tempDir=tempDir;this.exec=exec;this.projectId=projectId;
    mkdirSync(tempDir,{recursive:true,mode:0o700});
  }
  async #run(args){
    const result=await this.exec(this.binary,args);
    if(!result||result.ok===false||result.result?.ok===false)throw Error('WebHelm action failed: '+String(result?.result?.error??result?.error??'unknown error').slice(0,300));
    return result.result?.value??result.result??result;
  }
  async #config(action,config,{autoSession=true}={}){
    const file=join(this.tempDir,'config-'+key()+'.json');
    writeFileSync(file,JSON.stringify(config),{mode:0o600,flag:'wx'});
    try{return await this.#run(['platform','run','chatgpt',action,...(autoSession?['--auto-session']:[]),'--config',file]);}
    finally{rmSync(file,{force:true});}
  }
  async newThread(text,enforcement_context=''){
    const response=await this.#config('new-thread',{
      ...(this.projectId?{project_id:this.projectId}:{}),message:text,enforcement_context,mode:'chat',temporary:false,
    });
    if(response.status!=='submitted'||typeof response.thread_id!=='string'||!/^https:\/\/chatgpt\.com\//.test(response.thread_url??''))
      throw Error('new-thread returned no verified submission receipt');
    if(this.projectId && (response.project_id!==this.projectId||
      !new URL(response.thread_url).pathname.includes('/g/'+this.projectId)))
      throw Error('new-thread did not verify the configured ChatGPT Project');
    return response;
  }
  async newTurn(threadId,text,_files=[],idempotencyKey,projectId=null,enforcement_context=''){
    const response=await this.#config('new-turn',{
      ...(projectId?{project_id:projectId}:{}),
      thread_id:threadId,message:text,enforcement_context,mode:'async',mergeable:false,
      idempotency_key:idempotencyKey
    },{autoSession:false});
    if(response.status!=='submitted'||response.thread_id!==threadId||!response.queue_id)
      throw Error('new-turn returned no verified queue receipt');
    return response;
  }
  async waitForResult(id,store,{timeoutMs=9*60*1000,maxMs=30*60*1000,pollMs=350}={}){
    const started=Date.now();
    while(Date.now()-started<maxMs){
      const r=store.response(id);
      if(r?.status==='completed')return (r.output??[]).map(item=>item.content?.[0]?.text??'').join('\n');
      if(r?.status==='failed')throw Error(r.error?.message??'model request failed');
      const lastActivity=Math.max(started,Number(r?.last_activity_at)||0);
      if(Date.now()-lastActivity>=timeoutMs)throw Error('ChatGPT model result not reported before inactivity timeout');
      await sleep(pollMs);
    }
    throw Error('ChatGPT model result not reported before maximum duration');
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
