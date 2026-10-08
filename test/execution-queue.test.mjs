import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const cli=resolve('skills/execution-queue/queue.mjs');
function run(argv,env) { return new Promise(resolve=>{const p=spawn(process.execPath,[cli,...argv],{env:{...process.env,...env}});let out='',err='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err+=d);p.on('close',code=>resolve({code,out,err}));});}
test('two independent callers serialize, preserve streams and exit status',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'neoq-e2e-')),env={NEO_QUEUE_HOME:dir};
 const worker=spawn(process.execPath,[cli,'worker'],{env:{...process.env,...env},stdio:'ignore'});
 try {
  await new Promise(r=>setTimeout(r,250));
  const script="const fs=require('fs');const p=process.argv[1];const n=Number(fs.existsSync(p)?fs.readFileSync(p):0);if(n)process.exit(77);fs.writeFileSync(p,'1');setTimeout(()=>{fs.writeFileSync(p,'0');console.log('out');console.error('err')},200)";
  const lock=join(dir,'exclusive');
  const a=run(['run','--queue','media-ai','--',process.execPath,'-e',script,lock],env);
  const b=run(['run','--queue','media-ai','--',process.execPath,'-e',script,lock],env);
  const results=await Promise.all([a,b]);
  for(const v of results){assert.equal(v.code,0);assert.match(v.out,/out/);assert.match(v.err,/err/);}
  const failure=await run(['run','--',process.execPath,'-e','process.exit(17)'],env);
  assert.equal(failure.code,17);
 }finally {worker.kill('SIGTERM');await new Promise(r=>worker.once('close',r));rmSync(dir,{recursive:true,force:true});}
});

test('timeout exits nonzero and does not block next job',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'neoq-timeout-')),env={NEO_QUEUE_HOME:dir};
 const worker=spawn(process.execPath,[cli,'worker'],{env:{...process.env,...env},stdio:'ignore'});
 try{
  await new Promise(r=>setTimeout(r,250));
  const timed=await run(['run','--timeout','250','--',process.execPath,'-e','setTimeout(()=>{},10000)'],env);
  assert.notEqual(timed.code,0);
  const after=await run(['run','--','/bin/echo','AFTER'],env);
  assert.equal(after.code,0);assert.match(after.out,/AFTER/);
 }finally{worker.kill('SIGTERM');await new Promise(r=>worker.once('close',r));rmSync(dir,{recursive:true,force:true});}
});

test('restart reaps an abandoned process group before running queued work',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'neoq-recover-')),env={NEO_QUEUE_HOME:dir};
 const start=()=>spawn(process.execPath,[cli,'worker'],{env:{...process.env,...env},stdio:'ignore'});
 let worker=start();
 try {
  await new Promise(r=>setTimeout(r,250));
  const id=(await run(['submit','--queue','media-ai','--timeout','15000','--',process.execPath,'-e',"require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});setInterval(()=>{},1000)"],env)).out.trim();
  assert.ok(id);
  const started=async()=>{for(let i=0;i<50;i++){const list=JSON.parse((await run(['list'],env)).out);if(list.find(j=>j.id===id)?.status==='running') return true;await new Promise(r=>setTimeout(r,100));}return false;};
  assert.equal(await started(),true);
  worker.kill('SIGKILL');await new Promise(r=>worker.once('close',r));
  worker=start();
  await new Promise(r=>setTimeout(r,250));
  const next=await run(['run','--queue','media-ai','--','/bin/echo','RECOVERED'],env);
  assert.equal(next.code,0);assert.match(next.out,/RECOVERED/);
 }finally{worker.kill('SIGTERM');await new Promise(r=>worker.once('close',r));rmSync(dir,{recursive:true,force:true});}
});
