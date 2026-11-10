import {openSync,closeSync,unlinkSync,existsSync,readFileSync,writeFileSync,renameSync,mkdirSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {GpuError,parse,integer,money,findService} from '../common.mjs';
import {service,services,session,saveSession,sessionFile,register,token,tokenFile,validateService} from './store.mjs';
import {reserveBudget,createProviderSession,destroyProviderSession,spawnWatchdog} from './providers.mjs';
import {createGateway} from './gateway.mjs';

const publicBase=()=>process.env.NEO_GPU_WEB_ORIGIN||'https://gpu.qili2.com';
function existing(name){const config=service(name);if(!config)throw new GpuError('Unknown GPU web service: '+name);return config;}
export function webAdd(args){
  const opts=parse(args,{values:['--provider','--budget','--max-seconds','--flavor','--gpu','--disk','--max-hourly','--countries']});
  if(opts._.length!==1)throw new GpuError('usage: neo gpu web add SERVICE [--provider hf|vast]');
  const name=validateService(opts._[0]);
  const built=findService(name);
  if(!built || built.mode!=='web' || !built.published)throw new GpuError('Build and publish this service with neo gpu build --mode web first');
  const provider=opts.provider||'hf';
  if(!['hf','vast'].includes(provider))throw new GpuError('Unknown GPU web provider');
  const seconds=integer(opts.max_seconds||'3600','--max-seconds',{min:300,max:3600});
  const budget=money(opts.budget||'2','--budget',{max:5});
  const config={image:built.image,provider,seconds,budget,
    flavor:opts.flavor||'l4x1',gpu:opts.gpu||'RTX 4090',disk:integer(opts.disk||'80','--disk',{min:40,max:500}),
    maxHourly:money(opts.max_hourly||'.85','--max-hourly',{max:5}),
    countries:(opts.countries||'US,CA').split(','),appPort:built.appPort||7860};
  const secret=register(name,config);
  console.log(JSON.stringify({service:name,url:`${publicBase()}/${name}/`,
    token:secret,provider,hardShutdownSeconds:seconds,
    note:'Save token securely. Possession permits browser Start GPU actions up to configured budget.'},null,2));
}
export function webToken(args){
  if(args.length!==1)throw new GpuError('usage: neo gpu web token SERVICE');
  const name=validateService(args[0]);existing(name);
  console.log(JSON.stringify({service:name,token:token(name),url:`${publicBase()}/${name}/`}));
}
export function webRotate(args){
  if(args.length!==1)throw new GpuError('usage: neo gpu web rotate SERVICE');
  const name=validateService(args[0]);existing(name);
  const next=randomBytes(32).toString('base64url');
  const file=tokenFile(name),tmp=file+'.rotation-'+randomBytes(8).toString('hex');
  writeFileSync(tmp,next+'\n',{mode:0o600,flag:'wx'});
  renameSync(tmp,file);
  console.log(JSON.stringify({service:name,token:next,rotated:true}));
}
function lockFile(name){return sessionFile(name)+'.lock';}
async function exclusive(name,fn){
  mkdirSync(sessionFile(name).replace(/\/[^/]+$/, ''),{recursive:true,mode:0o700});
  const file=lockFile(name);let handle;
  try{handle=openSync(file,'wx',0o600);}catch{throw new GpuError('GPU web service has an operation in progress');}
  try{return await fn();}finally{closeSync(handle);unlinkSync(file);}
}
export async function startSession(name,{approved=false}={}){
  const config=existing(name);
  if(!approved)throw new GpuError('GPU session requires explicit --allow-spend');
  return exclusive(name,async()=>{
    const prior=session(name);
    if(!['stopped','failed'].includes(prior.phase))throw new GpuError('GPU web session already active or needs reconciliation: '+prior.phase);
    const reserve=reserveBudget(config);
    const initial={provider:config.provider,image:config.image,phase:'starting',
      startedAt:Date.now(),deadline:Date.now()+config.seconds*1000,budget:config.budget,
      rate:reserve.rate,service:name};
    saveSession(name,initial);
    // Start the watchdog before the potentially slow provider create call.
    // If this process crashes, it can still reconcile by the reserved label.
    spawnWatchdog(name);
    try{
      const resource=await createProviderSession(name,config,reserve,initial);
      const active={...initial,...resource,phase:'running'};
      saveSession(name,active);
      return {service:name,phase:'running',deadline:active.deadline};
    }catch(err){
      const current=session(name);
      if(current.phase==='starting')saveSession(name,{...current,phase:'failed',reason:String(err.message||'').slice(0,130)});
      throw err;
    }
  });
}
export async function stopSession(name){
  existing(name);
  return exclusive(name,async()=>{
    const state=session(name);
    if(state.phase==='stopped'||state.phase==='failed')return {service:name,phase:state.phase};
    if(state.phase==='starting')throw new GpuError('Session starting; retry when provider ID is known');
    if(state.phase==='unreconciled')throw new GpuError('Ambiguous provider creation; reconcile by label before retry');
    saveSession(name,{...state,phase:'stopping'});
    try{
      const terminalStatus=await destroyProviderSession(state);
      saveSession(name,{...state,phase:'stopped',terminalStatus,stoppedAt:Date.now()});
      return {service:name,phase:'stopped',terminalStatus};
    }catch(err){saveSession(name,{...state,phase:'cleanup_failed'});spawnWatchdog(name);throw err;}
  });
}
export function webStatus(args){
  if(args.length>1)throw new GpuError('usage: neo gpu web status [SERVICE]');
  if(args.length){const name=validateService(args[0]);console.log(JSON.stringify({service:name,config:existing(name),session:session(name),url:`${publicBase()}/${name}/`},null,2));return;}
  const out={};for(const [name,config] of Object.entries(services().services))out[name]={provider:config.provider,session:session(name).phase,url:`${publicBase()}/${name}/`};
  console.log(JSON.stringify(out,null,2));
}
export async function webMain(args){
  const [cmd,...rest]=args;
  switch(cmd){
    case 'add':webAdd(rest);return;
    case 'token':webToken(rest);return;
    case 'rotate':webRotate(rest);return;
    case 'status':webStatus(rest);return;
    case 'start':{
      const parsed=parse(rest,{switches:['--allow-spend']});
      if(parsed._.length!==1)throw new GpuError('usage: neo gpu web start SERVICE --allow-spend');
      console.log(JSON.stringify(await startSession(parsed._[0],{approved:!!parsed.allow_spend})));return;
    }
    case 'stop':if(rest.length!==1)throw new GpuError('usage: neo gpu web stop SERVICE');
      console.log(JSON.stringify(await stopSession(rest[0])));return;
    case 'serve':{
      const parsed=parse(rest,{values:['--port','--origin']});
      if(parsed._.length)throw new GpuError('usage: neo gpu web serve [--port 8798]');
      const port=integer(parsed.port||'8798','--port',{min:1024,max:65535});
      const server=createGateway({port,origin:parsed.origin||publicBase()});
      await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
      console.log(JSON.stringify({event:'neo_gpu_web_gateway_ready',port,origin:parsed.origin||publicBase()}));return;
    }
    default:console.log(`neo gpu web add SERVICE | token SERVICE | rotate SERVICE | status [SERVICE] |
  start SERVICE --allow-spend | stop SERVICE | serve [--port 8798]`);
  }
}
