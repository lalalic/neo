import {spawn} from 'node:child_process';
import {writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname,join} from 'node:path';
import {key} from './input.mjs';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export class WebHelmTransport {
  constructor({binary=join(homedir(),'.local','bin','webhelm'),tempDir=join(homedir(),'.local','share','neo','model-gateway','tmp'),exec=runCLI}={}){
    this.binary=binary;this.tempDir=tempDir;this.exec=exec;
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
  async newThread(text){
    const response=await this.#config('new-thread',{message:text,mode:'chat',temporary:false});
    if(response.status!=='submitted'||typeof response.thread_id!=='string'||!/^https:\/\/chatgpt\.com\//.test(response.thread_url??''))
      throw Error('new-thread returned no verified submission receipt');
    return response;
  }
  async newTurn(threadId,text,_files=[],idempotencyKey){
    const response=await this.#config('new-turn',{
      thread_id:threadId,message:text,mode:'async',mergeable:false,
      idempotency_key:idempotencyKey
    },{autoSession:false});
    if(response.status!=='submitted'||response.thread_id!==threadId||!response.queue_id)
      throw Error('new-turn returned no verified queue receipt');
    return response;
  }
  async waitForResult(id,store,{timeoutMs=9*60*1000,pollMs=350}={}){
    const end=Date.now()+timeoutMs;
    while(Date.now()<end){
      const r=store.response(id);
      if(r?.status==='completed')return r.output?.[0]?.content?.[0]?.text??'';
      if(r?.status==='failed')throw Error(r.error?.message??'model request failed');
      await sleep(pollMs);
    }
    throw Error('ChatGPT model result not reported before timeout');
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
