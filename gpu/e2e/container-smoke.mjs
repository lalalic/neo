#!/usr/bin/env node
// Real Dockerfile -> Neo wrapper -> HTTP E2E, in both modes, without rented GPU.
// Intended for GitHub Actions or any local machine with Docker Buildx.
import {execFileSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=resolve(fileURLToPath(new URL('../..',import.meta.url)));
const base='neo-gpu-tiny-e2e-base:'+process.pid;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const docker=(...args)=>execFileSync('docker',args,{cwd:root,encoding:'utf8',timeout:15*60*1000,stdio:['ignore','pipe','pipe']}).trim();
const output=(event,more={})=>console.log(JSON.stringify({event,...more}));
let running=null;
async function awaitHealth(port,service){
  for(let attempt=0;attempt<80;attempt++){
    try{
      const res=await fetch(`http://127.0.0.1:${port}/health`,{signal:AbortSignal.timeout(2000)});
      if(res.ok){const info=await res.json();if(info.ok&&info.service===service)return;}
    }catch{}
    await sleep(200);
  }
  throw Error(`Container did not start ${service} on ${port}`);
}
function wrap(mode,cmd,service){
  const image='neo-gpu-tiny-e2e-'+mode+':ci';
  docker('buildx','build','--builder','default','--load','-f','gpu/runtime/Dockerfile.wrap',
    '--build-context','neo-runtime=./gpu/runtime',
    '--build-arg',`NEO_BASE_IMAGE=${base}`, '--build-arg',`NEO_GPU_CMD_JSON=${JSON.stringify(cmd)}`,
    '--build-arg',`NEO_GPU_MODE=${mode}`,'--build-arg','NEO_GPU_APP_PORT=7860',
    '--build-arg',`NEO_GPU_SERVICE_NAME=${service}`,'-t',image,'.');
  return image;
}
async function launch(image,port){
  const name='neo-gpu-e2e-'+randomUUID().slice(0,8);
  running=docker('run','-d','--rm','--name',name,'-p',`127.0.0.1:${port}:8000`,image);
  if(!/^[a-f0-9]{64}$/.test(running))throw Error('Docker did not return a container ID');
}
function stop(){if(running){try{docker('rm','-f',running);}catch{}running=null;}}
async function checkBatch(image){
  const port=18501;await launch(image,port);
  try{
    await awaitHealth(port,'neo-gpu-v1');
    const id='docker_e2e_'+randomUUID().replaceAll('-','');
    const input={requestId:id,text:'Test Neo GPU batch from real Docker container'};
    const upload=await fetch(`http://127.0.0.1:${port}/inputs/request.json`,{
      method:'POST',headers:{'Content-Type':'application/octet-stream'},body:JSON.stringify(input)});
    if(!upload.ok||!(await upload.json()).bytes)throw Error('Docker batch upload failed');
    const start=await fetch(`http://127.0.0.1:${port}/start`,{method:'POST',body:'{}'});
    if(start.status!==202)throw Error('Docker batch worker was not accepted');
    let complete=false;
    for(let i=0;i<90;i++){
      const state=await(await fetch(`http://127.0.0.1:${port}/status`)).json();
      if(state.phase==='failed')throw Error(`Docker batch worker failed: ${state.log}`);
      if(state.phase==='completed'){complete=true;break;}
      await sleep(120);
    }
    if(!complete)throw Error('Docker batch worker did not finish');
    const result=await(await fetch(`http://127.0.0.1:${port}/outputs/result.json`)).json();
    if(result.mode!=='batch'||result.signature!=='neo-gpu-e2e-v1'||result.requestId!==id||
       result.textSha256!==createHash('sha256').update(input.text).digest('hex')||
       result.bytes!==Buffer.byteLength(input.text))throw Error('Docker batch output mismatch');
    output('DOCKER_BATCH_E2E_PASS',{bytes:result.bytes,sha256:result.textSha256});
  }finally{stop();}
}
async function checkWeb(image){
  const port=18502;await launch(image,port);
  try{
    await awaitHealth(port,'neo-gpu-web-v1');
    const nonce=randomUUID();
    const response=await fetch(`http://127.0.0.1:${port}/api/echo?nonce=${nonce}`,{
      headers:{Authorization:'Bearer dummy-should-not-reach-app'}});
    if(!response.ok)throw Error('Docker web request rejected');
    const result=await response.json();
    if(result.signature!=='neo-gpu-e2e-v1'||result.mode!=='web'||result.query!==nonce||
       result.hasProviderToken!==false||result.hasNeoCookie!==false)
      throw Error('Docker web routing/credential isolation mismatch');
    const page=await(await fetch(`http://127.0.0.1:${port}/`)).text();
    if(!page.includes('Neo GPU E2E WEB PASS'))throw Error('Docker web UI missing');
    output('DOCKER_WEB_E2E_PASS',{query:nonce,credentialLeak:false});
  }finally{stop();}
}
async function main(){
  docker('buildx','build','--builder','default','--load','-f','gpu/e2e/Dockerfile','-t',base,'.');
  const baseInfo=JSON.parse(docker('image','inspect',base))[0];
  const cmd=[...(baseInfo.Config.Entrypoint||[]),...(baseInfo.Config.Cmd||[])];
  if(!cmd.length||!cmd.every(x=>typeof x==='string'))throw Error('Dockerfile has no valid CMD');
  output('DOCKERFILE_BUILT',{dockerfile:'gpu/e2e/Dockerfile'});
  await checkBatch(wrap('batch',cmd,'neo-gpu-e2e-job'));
  await checkWeb(wrap('web',cmd,'neo-gpu-e2e-web'));
  output('NEO_GPU_DOCKER_E2E_PASS',{batch:true,web:true,providerJobsCreated:0});
}
main().catch(err=>{stop();console.error('NEO_GPU_DOCKER_E2E_FAIL',String(err.message||err));process.exitCode=1;});
