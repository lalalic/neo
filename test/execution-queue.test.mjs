import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const cli=resolve('skills/queue/queue.mjs');
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
  const recoveryStarted=Date.now();
  worker=start();
  await new Promise(r=>setTimeout(r,250));
  const next=await run(['run','--queue','media-ai','--','/bin/echo','RECOVERED'],env);
  assert.equal(next.code,0);assert.match(next.out,/RECOVERED/);assert.ok(Date.now()-recoveryStarted<7000,'recovery must terminate prior process tree, not wait for its timeout');
 }finally{worker.kill('SIGTERM');await new Promise(r=>worker.once('close',r));rmSync(dir,{recursive:true,force:true});}
});

test('dedupe survives one waiter interrupt',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'neoq-dedupe-')),env={NEO_QUEUE_HOME:dir};
 const worker=spawn(process.execPath,[cli,'worker'],{env:{...process.env,...env},stdio:'ignore'});
 try {
  await new Promise(r=>setTimeout(r,250));
  const argv=['run','--queue','media-ai','--dedupe','shared-123','--',process.execPath,'-e',"setTimeout(()=>console.log('SHARED'),700)"];
  const first=spawn(process.execPath,[cli,...argv],{env:{...process.env,...env},stdio:'ignore'});
  await new Promise(r=>setTimeout(r,140));
  const second=run(argv,env);
  await new Promise(r=>setTimeout(r,150));
  first.kill('SIGINT');
  const result=await second;
  assert.equal(result.code,0);assert.match(result.out,/SHARED/);
 }finally {worker.kill('SIGTERM');await new Promise(r=>worker.once('close',r));rmSync(dir,{recursive:true,force:true});}
});

test('configured queue capacities allow parallel work but media-ai is always sequential',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'neoq-capacity-')),env={NEO_QUEUE_HOME:dir,NEO_QUEUE_CAPACITIES:JSON.stringify({fast:2,'media-ai':1})};
 const worker=spawn(process.execPath,[cli,'worker'],{env:{...process.env,...env},stdio:'ignore'});
 try{
  await new Promise(r=>setTimeout(r,250));
  const begin=Date.now();
  const command=['run','--queue','fast','--',process.execPath,'-e','setTimeout(()=>console.log("OK"),550)'];
  const results=await Promise.all([run(command,env),run(command,env)]);
  assert.ok(results.every(v=>v.code===0));
  assert.ok(Date.now()-begin<1100,'capacity two must execute concurrently');
  const start=Date.now();
  const media=['run','--queue','media-ai','--',process.execPath,'-e','setTimeout(()=>console.log("OK"),500)'];
  await Promise.all([run(media,env),run(media,env)]);
  assert.ok(Date.now()-start>=950,'media-ai must remain sequential');
 }finally{worker.kill('SIGTERM');await new Promise(r=>worker.once('close',r));rmSync(dir,{recursive:true,force:true});}
});
test('failed command retries only with explicit opt-in',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'neoq-retries-')),env={NEO_QUEUE_HOME:dir};
 const worker=spawn(process.execPath,[cli,'worker'],{env:{...process.env,...env},stdio:'ignore'});
 try{
  await new Promise(r=>setTimeout(r,250));
  const marker=join(dir,'attempts');
  const script='const fs=require("fs");const f=process.argv[1];if(!fs.existsSync(f)){fs.writeFileSync(f,"1");process.exit(19)}console.log("RETRIED")';
  const result=await run(['run','--retries','1','--',process.execPath,'-e',script,marker],env);
  assert.equal(result.code,0);assert.match(result.out,/RETRIED/);
  const entries=JSON.parse((await run(['list'],env)).out);
  assert.equal(entries[0].status,'completed');
 }finally{worker.kill('SIGTERM');await new Promise(r=>worker.once('close',r));rmSync(dir,{recursive:true,force:true});}
});

test('run fails clearly if worker is not live, submit remains durable',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'neoq-offline-')),env={NEO_QUEUE_HOME:dir};
 try{
  const failure=await run(['run','--','/bin/echo','NEVER'],env);
  assert.notEqual(failure.code,0);assert.match(failure.err,/worker unavailable/i);
  const submitted=await run(['submit','--','/bin/echo','SCHEDULED'],env);
  assert.equal(submitted.code,0);assert.match(submitted.out,/[a-f0-9-]{36}/i);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('cancel stops an active command and releases capacity',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'neoq-cancel-')),env={NEO_QUEUE_HOME:dir};
 const worker=spawn(process.execPath,[cli,'worker'],{env:{...process.env,...env},stdio:'ignore'});
 try{
  await new Promise(r=>setTimeout(r,250));
  const id=(await run(['submit','--queue','media-ai','--',process.execPath,'-e','setTimeout(()=>{},10000)'],env)).out.trim();
  for(let i=0;i<40;i++) {
   const jobs=JSON.parse((await run(['list'],env)).out);
   if(jobs.find(j=>j.id===id)?.status==='running') break;
   await new Promise(r=>setTimeout(r,100));
  }
  assert.equal((await run(['cancel',id],env)).code,0);
  const next=await run(['run','--queue','media-ai','--','/bin/echo','FREE'],env);
  assert.equal(next.code,0);assert.match(next.out,/FREE/);
  const jobs=JSON.parse((await run(['list'],env)).out);
  assert.equal(jobs.find(j=>j.id===id)?.status,'cancelled');
 }finally{worker.kill('SIGTERM');await new Promise(r=>worker.once('close',r));rmSync(dir,{recursive:true,force:true});}
});

test('SIGTERM worker terminates its active command',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'neoq-shutdown-')),env={NEO_QUEUE_HOME:dir};
 const worker=spawn(process.execPath,[cli,'worker'],{env:{...process.env,...env},stdio:'ignore'});
 try{
  await new Promise(r=>setTimeout(r,250));
  const id=(await run(['submit','--','/bin/sleep','60'],env)).out.trim();
  let job;
  for(let i=0;i<40;i++){
   job=JSON.parse((await run(['list'],env)).out).find(j=>j.id===id);
   if(job?.status==='running') break;
   await new Promise(r=>setTimeout(r,100));
  }
  assert.equal(job.status,'running');
  worker.kill('SIGTERM');
  await new Promise(r=>worker.once('close',r));
  job=JSON.parse((await run(['list'],env)).out).find(j=>j.id===id);
  assert.equal(job.status,'failed');
 }finally{if(worker.exitCode===null)worker.kill('SIGKILL');rmSync(dir,{recursive:true,force:true});}
});
test('argv is passed literally and caller cwd is preserved',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'neoq-argv-')),env={NEO_QUEUE_HOME:dir};
 const worker=spawn(process.execPath,[cli,'worker'],{env:{...process.env,...env},stdio:'ignore'});
 try{
  await new Promise(r=>setTimeout(r,250));
  const script='console.log(JSON.stringify({cwd:process.cwd(),args:process.argv.slice(1)}))';
  const val='a b; quoted phrase';
  const result=await run(['run','--',process.execPath,'-e',script,val],env);
  assert.equal(result.code,0);
  const parsed=JSON.parse(result.out.trim());
  assert.equal(parsed.cwd,process.cwd());assert.deepEqual(parsed.args,[val]);
 }finally{worker.kill('SIGTERM');await new Promise(r=>worker.once('close',r));rmSync(dir,{recursive:true,force:true});}
});
