import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,mkdirSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {createServer} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {imagePlan} from '../gpu/image.mjs';
import {planRun} from '../gpu/cli.mjs';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const neo=join(root,'.bin','neo.mjs');
const cli=(args,env={})=>spawnSync(process.execPath,[neo,'gpu',...args],{encoding:'utf8',env:{...process.env,...env},timeout:30000});
const fixture=()=>{const p=mkdtempSync(join(tmpdir(),'neo-gpu-node-test-'));return p;};

test('built-in Node CLI never delegates to external neo-gpu executable',()=>{
  const r=cli(['doctor'],{NEO_GPU_CLI:'missing-legacy-executable'});
  assert.equal(r.status,0,r.stderr);
  assert.equal(JSON.parse(r.stdout).node,process.version);
  assert.doesNotMatch(r.stdout,/neo-gpu provider not installed/i);
});

test('Dockerfile from any GitHub project becomes a versioned Neo GPU image plan',()=>{
  const project=fixture();
  try{
    const git=(...args)=>{const r=spawnSync('git',['-C',project,...args],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);};
    git('init','-q');git('remote','add','origin','git@github.com:lalalic/example-video.git');
    writeFileSync(join(project,'Dockerfile'),'FROM debian:bookworm-slim\nCMD ["sh","-c","true"]\n');
    git('add','Dockerfile');git('-c','user.name=Tester','-c','user.email=test@example.invalid','commit','-qm','init');
    const plan=imagePlan({project,dry_run:true});
    assert.equal(plan.name,'example-video');
    assert.match(plan.image,/^ghcr\.io\/lalalic\/example-video-gpu:sha-[a-f0-9]{12}$/);
    assert.equal(plan.repository,'lalalic/example-video');
    assert.equal(plan.dockerfile,'Dockerfile');
    const result=cli(['build','--project',project,'--dry-run']);
    assert.equal(result.status,0,result.stderr);
    assert.equal(JSON.parse(result.stdout).image,plan.image);
  }finally{rmSync(project,{recursive:true,force:true});}
});

test('GPU run validates media and never rents GPU in --dry-run mode',()=>{
  const dir=fixture();try{
    writeFileSync(join(dir,'input.txt'),'hello');
    const args=['run','--image','ghcr.io/lalalic/video:sha-aabbccddee11',
      '--input',`message.txt=${join(dir,'input.txt')}`,'--output',`result.txt=${join(dir,'result.txt')}`,'--dry-run'];
    const r=cli(args,{PATH:'/does-not-exist'});
    assert.equal(r.status,0,r.stderr);
    const plan=JSON.parse(r.stdout);
    assert.equal(plan.provider,'hf');assert.equal(plan.inputs[0].name,'message.txt');
    assert.equal(plan.outputs[0].name,'result.txt');
    const noSpend=cli(args.filter(x=>x!=='--dry-run'));
    assert.equal(noSpend.status,2);assert.match(noSpend.stderr,/--allow-spend/);
    assert.equal(existsSync(join(dir,'result.txt')),false);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('Node GPU service accepts inputs, executes Docker CMD, and exposes outputs once',async()=>{
  const dir=fixture(),inputs=join(dir,'inputs'),outputs=join(dir,'outputs');
  mkdirSync(inputs);mkdirSync(outputs);
  const program=join(dir,'worker.cjs');
  writeFileSync(program,'const fs=require("fs");const p=require("path");fs.copyFileSync(p.join(process.env.NEO_GPU_INPUT_DIR,"message.txt"),p.join(process.env.NEO_GPU_OUTPUT_DIR,"result.txt"));');
  const port=await new Promise((resolve,reject)=>{const s=createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const n=s.address().port;s.close(()=>resolve(n));});});
  const worker=spawn(process.execPath,[join(root,'gpu/runtime/service.mjs')],{
    env:{...process.env,NEO_GPU_PORT:String(port),NEO_GPU_INPUT_DIR:inputs,NEO_GPU_OUTPUT_DIR:outputs,
      NEO_GPU_CMD_JSON:JSON.stringify([process.execPath,program])},stdio:'ignore'});
  try{
    const base=`http://127.0.0.1:${port}`;
    let ready=false;
    for(let i=0;i<60;i++){try{const r=await fetch(base+'/health');if(r.ok){ready=true;break;}}catch{};await delay(50);}
    assert.equal(ready,true);
    const unsafe=await fetch(base+'/inputs/../secret',{method:'POST',body:'invalid'});
    assert.notEqual(unsafe.status,200);
    const upload=await fetch(base+'/inputs/message.txt',{method:'POST',body:Buffer.from('NEO GPU WORKS')});
    assert.equal(upload.status,200);assert.equal((await upload.json()).bytes,13);
    const start=await fetch(base+'/start',{method:'POST',body:'{}'});
    assert.equal(start.status,202);
    const duplicate=await fetch(base+'/start',{method:'POST',body:'{}'});
    assert.equal(duplicate.status,409);
    let state;
    for(let i=0;i<120;i++){state=await(await fetch(base+'/status')).json();if(state.phase!=='running')break;await delay(50);}
    assert.equal(state.phase,'completed',JSON.stringify(state));
    const out=await fetch(base+'/outputs/result.txt');
    assert.equal(out.status,200);assert.equal(await out.text(),'NEO GPU WORKS');
    assert.equal(readFileSync(join(outputs,'result.txt'),'utf8'),'NEO GPU WORKS');
    assert.equal((await fetch(base+'/outputs/missing.txt')).status,404);
  }finally{worker.kill('SIGTERM');await delay(100);rmSync(dir,{recursive:true,force:true});}
});
