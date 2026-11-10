#!/usr/bin/env node
// Default real CUDA smoke: the same tiny Dockerfile in HF/Vast batch and web.
// Non-billing dry-run unless --live and --allow-spend are both supplied.
import {spawn} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir,homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {imagePlan} from '../../image.mjs';
import {findService,saveService,atomicJson} from '../../common.mjs';
import {gatewayCredentialReady} from '../../e2e/gateway-prereq.mjs';
import {reusableFixtureImage} from '../../e2e/reuse.mjs';
const root=resolve(fileURLToPath(new URL('../../../',import.meta.url)));
const cli=join(root,'.bin/neo.mjs');
const dockerfile='gpu/examples/hello-neo/Dockerfile';
const args=new Set(process.argv.slice(2));
const allowed=new Set(['--live','--allow-spend','--build','--batch-only','--web-only','--help','--vast']);
const provider=args.has('--vast')?'vast':'hf';
const names={batch:'hello-neo-job',web:provider==='vast'?'hello-neo-vast-web':'hello-neo-web'};
const gpu=provider==='hf'?['--flavor','t4-small']:['--gpu','RTX 4090'];
const origin=process.env.NEO_COMPUTE_WEB_ORIGIN||process.env.NEO_GPU_WEB_ORIGIN||'https://compute.qili2.com';
const print=(event,fields={})=>console.log(JSON.stringify({event,...fields}));
if([...args].some(x=>!allowed.has(x))){console.error('Unknown Hello Neo option');process.exit(2);}
if(args.has('--help')){console.log('node gpu/examples/hello-neo/e2e.mjs [--live --allow-spend --build] [--vast] [--batch-only|--web-only]');process.exit(0);}
const live=args.has('--live')&&args.has('--allow-spend');
if(args.has('--live')!==args.has('--allow-spend')||(args.has('--build')&&!live)||
   (args.has('--batch-only')&&args.has('--web-only'))){console.error('Live execution requires both --live and --allow-spend.');process.exit(2);}
const modes=args.has('--batch-only')?['batch']:args.has('--web-only')?['web']:['batch','web'];
const wait=ms=>new Promise(done=>setTimeout(done,ms));
async function command(parts,{quiet=false,timeoutMs=570000}={}){
  const child=spawn(process.execPath,[cli,'compute',...parts],{cwd:root,stdio:['ignore','pipe','pipe']});
  let out='',err='';
  child.stdout.on('data',x=>{out=(out+x).slice(-50000);if(!quiet)process.stdout.write(x);});
  child.stderr.on('data',x=>{err=(err+x).slice(-4000);if(!quiet)process.stderr.write(x);});
  const exit=await new Promise((ok,fail)=>{
    const timer=setTimeout(()=>{child.kill('SIGTERM');fail(Error('GPU subprocess timeout'));},timeoutMs);
    child.once('error',e=>{clearTimeout(timer);fail(e);});
    child.once('close',code=>{clearTimeout(timer);ok(code);});
  });
  if(exit!==0)throw Error(`${parts[0]} ${parts[1]||''} exit=${exit}: ${err.slice(-600)}`);
  return out;
}
function lastJson(out){
  try{return JSON.parse(out.trim());}catch{}
  for(const row of out.trim().split('\n').reverse()){try{return JSON.parse(row);}catch{}}
  throw Error('GPU CLI did not return JSON');
}
function assertGpu(result,mode,requestId){
  if(result.signature!=='hello-neo-v1'||result.mode!==mode||
     result.message!=='hello neo'||result.cudaSignature!=='hello-neo-cuda-v1'||
     result.cuda!==true||result.kernelResult!==42||!result.device||
     (mode==='batch'&&result.requestId!==requestId)||
     (mode==='web'&&(result.query!==requestId||result.hasNeoCookie!==false||result.hasProviderToken!==false)))
    throw Error('Real CUDA kernel proof failed or output contract mismatch');
}
async function images(){
  for(const mode of modes){
    const name=names[mode];
    // Reuse one Web image with distinct provider registrations.
    const buildName=mode==='web'?'hello-neo-web':name;
    const plan=imagePlan({project:root,dockerfile,name:buildName,mode,dry_run:true});
    print('hello_neo_image',{mode,image:plan.image});
    if(!live)continue;
    if(args.has('--build')&&name===buildName){
      await command(['build','--mode',mode,'--name',buildName,'--dockerfile',dockerfile]);
    }
    if(name!==buildName){
      const canonical=findService(buildName);
      if(!canonical?.published||canonical.mode!=='web'||!(canonical.image===plan.image||
        reusableFixtureImage(canonical,plan,root,[
          'gpu/examples/hello-neo/Dockerfile','gpu/examples/hello-neo/cuda-probe.c',
          'gpu/examples/hello-neo/app.mjs','gpu/runtime/'])))
        throw Error('Publish a verified Hello Neo Web image before testing Vast Web');
      const previous=findService(name);
      if(previous&&previous.image!==canonical.image)throw Error('Existing Vast Web image differs; refusing overwrite');
      if(!previous)saveService(name,{...canonical});
      print('hello_neo_image_aliased',{service:name,image:canonical.image});
    }
    const saved=findService(name);
    const unchanged=reusableFixtureImage(saved,plan,root,[
      'gpu/examples/hello-neo/Dockerfile','gpu/examples/hello-neo/cuda-probe.c',
      'gpu/examples/hello-neo/app.mjs','gpu/runtime/']);
    if(!saved||!saved.published||saved.mode!==mode||
       (saved.image!==plan.image&&!unchanged))
      throw Error(`No published ${name} image matches this fixture. Run with --build after pushing the commit.`);
    print('hello_neo_image_ready',{mode,image:saved.image});
  }
}
async function batch(){
  const dir=mkdtempSync(join(tmpdir(),'hello-neo-cuda-'));
  const requestId='gpu_'+randomUUID().replaceAll('-','');
  const input=join(dir,'request.json'),output=join(dir,'result.json');
  try{
    writeFileSync(input,JSON.stringify({message:'hello neo',requestId})+'\n');
    const receipt=await command(['run',names.batch,'--provider',provider,...gpu,
      '--max-seconds','420','--budget','2','--input',`request.json=${input}`,
      '--output',`result.json=${output}`,'--allow-upload','--allow-spend']);
    const data=JSON.parse(readFileSync(output,'utf8'));
    assertGpu(data,'batch',requestId);
    if(!receipt.includes('NEO_GPU_RUN_PASS')||
       !receipt.includes(provider==='hf'?'hf_job_cleaned':'vast_destroyed'))throw Error('Missing Job completion or verified provider cleanup');
    print('HELLO_NEO_BATCH_PASS',{provider,device:data.device,kernelResult:data.kernelResult,cleaned:true});
    return {device:data.device,kernelResult:42,cleaned:true};
  }finally{rmSync(dir,{recursive:true,force:true});}
}
async function web(){
  if(provider==='hf'&&!gatewayCredentialReady())throw Error('Gateway must have its private HF credential file before renting.');
  const name=names.web,base=`${origin}/${name}/`;
  const statuses=lastJson(await command(['web','status'],{quiet:true}));
  let registered=false,started=false;
  if(!statuses[name]){
    const response=lastJson(await command(['web','add',name,'--provider',provider,...gpu,
      '--budget','2','--max-seconds','300'],{quiet:true}));
    if(!response.token||response.hardShutdownSeconds!==300)throw Error('Web registration invalid');
    registered=true;
  }else if(statuses[name].session!=='stopped')throw Error('Hello Neo Web is already active; do not disrupt another session');
  const status=lastJson(await command(['web','status',name],{quiet:true}));
  if(status.config.provider!==provider||status.config.image!==findService(name).image||status.config.seconds!==300)
    throw Error('Existing Hello Neo Web registration does not match this test; do not overwrite');
  const {token}=await import('../../web/store.mjs');
  const secret=token(name);
  try{
    let response=await fetch(base,{signal:AbortSignal.timeout(10000),redirect:'manual'});
    if(response.status!==401)throw Error('Web must deny unauthenticated access');
    response=await fetch(base+'_login',{method:'POST',body:new URLSearchParams({token:secret}),
      signal:AbortSignal.timeout(10000),redirect:'manual'});
    if(response.status!==303)throw Error('Hello Neo token authentication failed');
    const cookie=response.headers.get('set-cookie')?.split(';')[0];
    if(!cookie||!cookie.startsWith('neo_gpu_'))throw Error('Neo auth cookie missing');
    started=true; // inspect and clean up even when the provider creates a Job but CLI returns an error
    await command(['web','start',name,'--allow-spend'],{quiet:true,timeoutMs:80000});
    const nonce='cuda_'+randomUUID().replaceAll('-','');
    let passed=null,lastError='';
    const deadline=Date.now()+215000;
    while(Date.now()<deadline){
      try{
        const res=await fetch(base+'api/hello?nonce='+nonce,{headers:{Cookie:cookie},signal:AbortSignal.timeout(12000)});
        if(res.status===200&&res.headers.get('content-type')?.includes('application/json')){
          const data=await res.json();assertGpu(data,'web',nonce);passed=data;break;
        }
        lastError=`HTTP ${res.status}`;
      }catch(e){lastError=e.message;}
      await wait(5000);
    }
    if(!passed)throw Error('Hello Neo GPU web kernel verification failed: '+lastError);
    print('HELLO_NEO_WEB_PASS',{provider,device:passed.device,kernelResult:passed.kernelResult,authPassed:true,providerTokenIsolated:true,url:base});
    return {device:passed.device,kernelResult:42,authPassed:true,url:base};
  }finally{
    if(started){
      const state=lastJson(await command(['web','status',name],{quiet:true})).session;
      if(['running','stopping','cleanup_failed'].includes(state.phase)){
        const stopped=lastJson(await command(['web','stop',name],{quiet:true,timeoutMs:80000}));
        if(stopped.phase!=='stopped')throw Error('Provider stopped state not confirmed');
        print('HELLO_NEO_WEB_CLEANED',{provider,remoteStopped:true});
      }else if(!['stopped','failed'].includes(state.phase))
        throw Error('Provider create state ambiguous: '+state.phase+'; reconcile before another rental');
    }
    if(registered)print('hello_neo_web_registered',{service:name,session:'stopped',url:base});
  }
}
async function main(){
  await images();
  if(!live){print('hello_neo_dry_run_pass',{provider,providerJobsCreated:0});return;}
  const results={};
  const receipt={version:1,provider,imageNames:names,at:new Date().toISOString(),results,passed:false};
  try{
    if(modes.includes('batch'))results.batch=await batch();
    if(modes.includes('web'))results.web=await web();
    receipt.passed=true;
    print('HELLO_NEO_GPU_E2E_PASS',{provider,batch:!!results.batch,web:!!results.web});
  }finally{
    const out=join(homedir(),'.local/state/neo/gpu/hello-neo');mkdirSync(out,{recursive:true,mode:0o700});
    atomicJson(join(out,'receipt-'+Date.now()+'.json'),receipt);
  }
}
main().catch(e=>{console.error('HELLO_NEO_GPU_E2E_FAIL',e.message);process.exitCode=1;});
