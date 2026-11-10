import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,statSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {createServer} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {register,service,saveSession,tokenFile,sessionFile} from '../gpu/web/store.mjs';
import {webRemove} from '../gpu/web/manager.mjs';
import {hfRunArgs} from '../gpu/providers/hf.mjs';
import {hfWebArgs} from '../gpu/web/providers.mjs';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const fixture=join(root,'gpu/e2e/fixture.mjs');
const runner=join(root,'gpu/e2e/run.mjs');
function temp(){return mkdtempSync(join(tmpdir(),'neo-gpu-fixture-test-'));}
async function ephemeralPort(){return new Promise((resolve,reject)=>{const s=createServer();s.on('error',reject);
  s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>resolve(port));});});}

test('one tiny Dockerfile declares the same Node fixture for batch and web',()=>{
  const file=readFileSync(join(root,'gpu/e2e/Dockerfile'),'utf8');
  assert.match(file,/FROM node:22-bookworm-slim/);
  assert.match(file,/CMD \["node", "\/app\/fixture.mjs"\]/);
  assert.doesNotMatch(file.split('\n').filter(line=>!line.trim().startsWith('#')).join('\n'),/cuda|pytorch|pip install/i);
});

test('both HF provider modes pass the required explicit image command',()=>{
  const image='ghcr.io/lalalic/neo-gpu:sha-abcdefabcdef';
  const batch=hfRunArgs({image,flavor:'cpu-basic',maxSeconds:420,name:'e2e-batch'});
  assert.deepEqual(batch.slice(-3),[image,'/opt/neo-gpu/node','/opt/neo-gpu/launcher.mjs']);
  assert.equal(batch[batch.indexOf('--timeout')+1],'420s');
  assert.deepEqual(hfWebArgs({image,flavor:'cpu-basic',seconds:300},'e2e-web').slice(-3),
    [image,'/opt/neo-gpu/node','/opt/neo-gpu/launcher.mjs']);
});

test('local batch fixture writes a verifiable result without renting GPU',()=>{
  const dir=temp(),input=join(dir,'input'),output=join(dir,'output');
  try{
    mkdirSync(input);mkdirSync(output);
    const request={requestId:'local_e2e_123456',text:'hello neo test ✅'};
    writeFileSync(join(input,'request.json'),JSON.stringify(request));
    const run=spawnSync(process.execPath,[fixture],{encoding:'utf8',env:{...process.env,
      NEO_GPU_MODE:'batch',NEO_GPU_INPUT_DIR:input,NEO_GPU_OUTPUT_DIR:output}});
    assert.equal(run.status,0,run.stderr);
    const result=JSON.parse(readFileSync(join(output,'result.json'),'utf8'));
    assert.deepEqual(result,{signature:'neo-gpu-e2e-v1',mode:'batch',requestId:request.requestId,
      textSha256:createHash('sha256').update(request.text).digest('hex'),bytes:Buffer.byteLength(request.text)});
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('local web fixture serves authenticated-proxy proof endpoint without GPU',async()=>{
  const port=await ephemeralPort();
  const app=spawn(process.execPath,[fixture],{env:{...process.env,NEO_GPU_MODE:'web',NEO_GPU_APP_PORT:String(port)},stdio:'ignore'});
  try{
    let response;for(let i=0;i<70;i++){
      try{response=await fetch(`http://127.0.0.1:${port}/api/echo?nonce=hello`);if(response.ok)break;}catch{}
      await delay(60);
    }
    assert.equal(response?.status,200);
    assert.deepEqual(await response.json(),{signature:'neo-gpu-e2e-v1',mode:'web',path:'/api/echo',
      query:'hello',hasProviderToken:false,hasNeoCookie:false});
    const html=await(await fetch(`http://127.0.0.1:${port}/`)).text();
    assert.match(html,/Neo GPU E2E WEB PASS/);
  }finally{app.kill('SIGTERM');await delay(80);}
});

test('reusable runner defaults to no-spend and requires both explicit live approvals',()=>{
  const dry=spawnSync(process.execPath,[runner],{cwd:root,encoding:'utf8',timeout:30000});
  assert.equal(dry.status,0,dry.stderr);
  assert.match(dry.stdout,/dry_run_pass/);
  assert.doesNotMatch(dry.stdout,/hf_job_created|web_start/);
  for(const opt of ['--live','--allow-spend','--build']){
    const rejected=spawnSync(process.execPath,[runner,opt],{cwd:root,encoding:'utf8',timeout:30000});
    assert.equal(rejected.status,2);
    assert.match(rejected.stderr,/BOTH --live and --allow-spend/);
  }
});

test('web test registration can be removed only after a stopped provider',async()=>{
  const dir=temp();
  const env={NEO_GPU_WEB_DIR:join(dir,'web'),NEO_GPU_WEB_SESSIONS:join(dir,'state')};
  const previous={NEO_GPU_WEB_DIR:process.env.NEO_GPU_WEB_DIR,NEO_GPU_WEB_SESSIONS:process.env.NEO_GPU_WEB_SESSIONS};
  Object.assign(process.env,env);
  const oldLog=console.log;let printed='';
  try{
    const t=register('e2e-test',{image:'ghcr.io/example/test:sha-abcdef123456'});
    assert.ok(t);
    saveSession('e2e-test',{phase:'running',provider:'hf',jobId:'0123456789abcdef01234567'});
    await assert.rejects(webRemove(['e2e-test']),/Stop and verify/);
    assert.ok(existsSync(tokenFile('e2e-test')));
    saveSession('e2e-test',{phase:'stopped',provider:'hf'});
    console.log=x=>printed=x;
    await webRemove(['e2e-test']);
    assert.equal(JSON.parse(printed).phase,'removed');
    assert.equal(service('e2e-test'),null);
    assert.equal(existsSync(tokenFile('e2e-test')),false);
    assert.equal(existsSync(sessionFile('e2e-test')),false);
  }finally{
    console.log=oldLog;
    for(const k of Object.keys(env)){
      if(previous[k]===undefined)delete process.env[k];else process.env[k]=previous[k];
    }
    rmSync(dir,{recursive:true,force:true});
  }
});
