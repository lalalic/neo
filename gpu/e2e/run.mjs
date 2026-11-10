#!/usr/bin/env node
// Repeatable, fail-closed E2E for a single tiny Dockerfile in BOTH Neo GPU modes.
// Dry-run by default; --live --allow-spend explicitly authorizes short HF jobs.
import {spawn} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir,homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {imagePlan} from '../image.mjs';
import {findService,atomicJson} from '../common.mjs';
import {reusableFixtureImage} from './reuse.mjs';
const project=resolve(fileURLToPath(new URL('../..',import.meta.url)));
const neo=join(project,'.bin','neo.mjs');
const dockerfile='gpu/e2e/Dockerfile';
const names={batch:'neo-gpu-e2e-job',web:'neo-gpu-e2e-web'};
const origin=process.env.NEO_GPU_WEB_ORIGIN||'https://gpu.qili2.com';
const sleep=ms=>new Promise(ok=>setTimeout(ok,ms));
const print=(event,data={})=>console.log(JSON.stringify({event,...data}));
const timeout=(ms)=>AbortSignal.timeout(ms);
const flags=new Set(process.argv.slice(2));
const allowed=new Set(['--live','--allow-spend','--build','--batch-only','--web-only','--help']);
if([...flags].some(x=>!allowed.has(x))){console.error('Unknown E2E option');process.exit(2);}
if(flags.has('--help')){console.log('node gpu/e2e/run.mjs [--live --allow-spend] [--build] [--batch-only|--web-only]');process.exit(0);}
const live=flags.has('--live')&&flags.has('--allow-spend');
if((flags.has('--live')!==flags.has('--allow-spend'))||(flags.has('--build')&&!live)||
  (flags.has('--batch-only')&&flags.has('--web-only'))){
  console.error('Real E2E requires BOTH --live and --allow-spend; --build also requires both.');process.exit(2);
}

async function cmd(args,{privateOutput=false,limitMs=3600000}={}) {
  const child=spawn(process.execPath,[neo,'gpu',...args],{cwd:project,stdio:['ignore','pipe','pipe']});
  let out='',err='';
  const cap=32*1024;
  child.stdout.on('data',x=>{out=(out+x).slice(-cap);if(!privateOutput)process.stdout.write(x);});
  child.stderr.on('data',x=>{err=(err+x).slice(-cap);if(!privateOutput)process.stderr.write(x);});
  const exit=await new Promise((done,reject)=>{
    const guard=setTimeout(()=>{child.kill('SIGTERM');reject(new Error('Neo GPU subprocess timed out'));},limitMs);
    child.on('error',e=>{clearTimeout(guard);reject(e);});
    child.on('close',code=>{clearTimeout(guard);done(code);});
  });
  if(exit!==0)throw new Error(`${args[0]} ${args[1]||''} exit=${exit}: ${err.slice(-800)}`);
  return out;
}
function lastJson(text){
  try{return JSON.parse(text.trim());}catch{}
  for(const line of text.trim().split('\n').reverse()){
  try{const x=JSON.parse(line);if(x&&typeof x==='object')return x;}catch{}
}throw Error('CLI did not return a JSON receipt');}
async function preflight(){
  const plans={};
  for(const mode of ['batch','web']){
    plans[mode]=imagePlan({project,dockerfile,mode,name:names[mode],dry_run:true});
    if(!/^ghcr\.io\/.+:sha-[a-f\d]{12}$/.test(plans[mode].image))throw Error('Non-versioned image');
    print('image_plan',{mode,service:names[mode],image:plans[mode].image});
  }
  if(plans.web.image===plans.batch.image)throw Error('Batch and web wrappers must use separate immutable tags');
  if(!live){
    const dir=mkdtempSync(join(tmpdir(),'neo-gpu-e2e-dry-'));
    try{
      const input=join(dir,'request.json');writeFileSync(input,JSON.stringify({requestId:'dry_run_12345678',text:'no GPU rented'}));
      const plan=lastJson(await cmd(['run','--image',plans.batch.image,'--provider','hf',
        '--input',`request.json=${input}`,'--output',`result.json=${join(dir,'result.json')}`,'--dry-run']));
      if(plan.mode!=='dry_run'||plan.provider!=='hf')throw Error('Dry-run did not stay safe');
      print('dry_run_pass',{gpuRentals:0,uploadCount:0});
    }finally{rmSync(dir,{recursive:true,force:true});}
  }
  return plans;
}
async function requireImage(mode,plan){
  const saved=findService(names[mode]);
  if(saved?.image===plan.image&&saved.published&&saved.mode===mode){
    print('image_reused',{mode,image:saved.image});return;
  }
  if(!flags.has('--build')&&reusableFixtureImage(saved,plan,project)){
    print('image_reused_verified',{mode,image:saved.image,sourceCommit:saved.sourceCommit.slice(0,8)});
    return;
  }
  if(!flags.has('--build'))throw Error(`Image not built: run with --live --allow-spend --build for ${mode}`);
  print('image_build_start',{mode});
  await cmd(['build','--mode',mode,'--name',names[mode],'--dockerfile',dockerfile,'--builder','github']);
  const result=findService(names[mode]);
  if(!result?.published||result.image!==plan.image)throw Error(`Image build receipt invalid: ${mode}`);
  print('image_build_pass',{mode,image:result.image});
}
async function batch(){
  const dir=mkdtempSync(join(tmpdir(),'neo-gpu-e2e-batch-'));
  const requestId='e2e_'+randomUUID().replaceAll('-','');
  const input=join(dir,'request.json'),output=join(dir,'result.json');
  const data={requestId,text:'Hello from Neo GPU real HF batch E2E!'};
  writeFileSync(input,JSON.stringify(data)+'\n');
  try{
    print('batch_start',{provider:'hf',flavor:'cpu-basic',maxSeconds:420});
    const logs=await cmd(['run',names.batch,'--provider','hf','--flavor','cpu-basic',
      '--max-seconds','420','--budget','1','--input',`request.json=${input}`,
      '--output',`result.json=${output}`,'--allow-upload','--allow-spend'],{limitMs:9*60*1000});
    const result=JSON.parse(readFileSync(output,'utf8'));
    const expectedHash=createHash('sha256').update(data.text).digest('hex');
    if(result.signature!=='neo-gpu-e2e-v1'||result.mode!=='batch'||
       result.requestId!==requestId||result.textSha256!==expectedHash||result.bytes!==Buffer.byteLength(data.text))
      throw Error('Batch output contract mismatch');
    if(!logs.includes('NEO_GPU_RUN_PASS')||!logs.includes('hf_job_cleaned'))
      throw Error('Missing real execution and provider cleanup receipts');
    print('batch_pass',{requestId,sha256:expectedHash,outputVerified:true,providerCleanup:true});
    return {requestId,sha256:expectedHash};
  }finally{rmSync(dir,{recursive:true,force:true});}
}
async function web(){
  const name=names.web,base=`${origin}/${name}/`;
  const prior=lastJson(await cmd(['web','status'],{privateOutput:true}));
  // Never take over a previous paid session or other user's test registration.
  if(prior[name])throw Error(`E2E web service already registered (${prior[name].session}); verify and remove manually first`);
  let registered=false,started=false,verifiedStopped=false,secret='';
  try{
    const registeredData=lastJson(await cmd(['web','add',name,'--provider','hf','--flavor','cpu-basic',
      '--budget','1','--max-seconds','300'],{privateOutput:true}));
    registered=true;secret=registeredData.token;
    if(!secret||registeredData.hardShutdownSeconds!==300)throw Error('Web token or deadline incorrect');
    print('web_registered',{service:name,origin,timeoutSeconds:300});
    let response=await fetch(base,{redirect:'manual',signal:timeout(10000)});
    if(response.status!==401)throw Error('Unauthenticated public web access was not denied');
    const noGpu=lastJson(await cmd(['web','status',name],{privateOutput:true}));
    if(noGpu.session.phase!=='stopped')throw Error('Visiting the URL triggered rental');
    response=await fetch(base+'_login',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({token:secret}),redirect:'manual',signal:timeout(10000)});
    if(response.status!==303)throw Error(`Web token authentication failed: ${response.status}`);
    const cookie=response.headers.get('set-cookie')?.split(';')[0];
    if(!cookie||!cookie.startsWith('neo_gpu_'))throw Error('Web login did not issue access cookie');
    const nonce=randomUUID();
    print('web_start',{provider:'hf',flavor:'cpu-basic',maxSeconds:300});
    await cmd(['web','start',name,'--allow-spend'],{privateOutput:true,limitMs:80000});started=true;
    let ready=null,lastError='';
    const deadline=Date.now()+225000;
    while(Date.now()<deadline){
      try{
        response=await fetch(base+`api/echo?nonce=${nonce}`,{headers:{Cookie:cookie},signal:timeout(10000)});
        if(response.ok && response.headers.get('content-type')?.includes('application/json')){
          const value=await response.json();
          if(value.signature==='neo-gpu-e2e-v1'&&value.mode==='web'&&value.query===nonce&&
             value.hasProviderToken===false&&value.hasNeoCookie===false){ready=value;break;}
          lastError='Web returned unexpected data';
        }else lastError=`HTTP ${response.status}`;
      }catch(e){lastError=String(e.message||e);}
      await sleep(5000);
    }
    if(!ready)throw Error(`Web app did not become ready: ${lastError}`);
    print('web_pass',{url:base,authPassed:true,proxyPassed:true,providerTokenIsolated:true});
    return {url:base,verified:true};
  }finally{
    if(registered){
      const status=lastJson(await cmd(['web','status',name],{privateOutput:true}));
      if(['running','stopping','cleanup_failed'].includes(status.session.phase)){
        const cleanup=lastJson(await cmd(['web','stop',name],{privateOutput:true,limitMs:80000}));
        verifiedStopped=cleanup.phase==='stopped';
      } else verifiedStopped=status.session.phase==='stopped'||status.session.phase==='failed';
      if(verifiedStopped){
        await cmd(['web','remove',name],{privateOutput:true});
        print('web_cleaned',{providerCleanup:started,registrationRemoved:true});
      }else print('web_needs_reconciliation',{service:name,phase:status.session.phase});
    }
  }
}

async function main(){
  const plans=await preflight();
  if(!live)return;
  // HF CPU tests exercise actual provider orchestration at negligible cost.
  // The hosted build is non-GPU and never downloads model weights.
  const modes=flags.has('--batch-only')?['batch']:flags.has('--web-only')?['web']:['batch','web'];
  for(const mode of modes)await requireImage(mode,plans[mode]);
  const receipt={version:1,fixture:'gpu/e2e/Dockerfile',provider:'hf',at:new Date().toISOString(),tests:{}};
  try {
    if(modes.includes('batch'))receipt.tests.batch=await batch();
    if(modes.includes('web'))receipt.tests.web=await web();
    receipt.passed=true;
    print('NEO_GPU_E2E_PASS',{batch:!!receipt.tests.batch,web:!!receipt.tests.web});
  }finally{
    const folder=join(homedir(),'.local','state','neo','gpu','e2e');mkdirSync(folder,{recursive:true,mode:0o700});
    atomicJson(join(folder,'receipt-'+Date.now()+'.json'),receipt);
  }
}
main().catch(e=>{console.error('NEO_GPU_E2E_FAIL',String(e.message||e));process.exitCode=1;});
