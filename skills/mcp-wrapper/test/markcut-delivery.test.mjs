import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {buildNeoReviewRequest,watchAndNotify} from '../markcut.mjs';
const hash='f'.repeat(64);
const template={type:'task.interactive_decision',source:'job/j1/task/producer/execution/e1',responseKey:'interactive',
  data:{interactive:{jobId:'j1',taskId:'producer',executionId:'e1'}}};
const op={state:'ready',requestedPath:'/tmp/movie.md',result:{id:hash,revisionId:hash,contentHash:hash,
  review:{delivery:'event',eventTemplate:template}}};
function withOp(data){const dir=mkdtempSync(join(tmpdir(),'neo-preview-test-'));const id=randomUUID();
  writeFileSync(join(dir,id+'.json'),JSON.stringify(data));return {dir,id,clean:()=>rmSync(dir,{recursive:true,force:true})};}
test('Neo builds immutable review request using provider output; Markcut does not notify',()=>{
  const id=randomUUID(),request=buildNeoReviewRequest(id,op,{jobId:'j1',taskId:'producer',executionId:'e1'});
  assert.equal(request.id,id);assert.equal(request.mediaHash,hash);assert.equal(request.commitSha,undefined);assert.equal(request.contentHash,undefined);
  assert.equal(request.title,'movie');assert.equal(request.delivery,'event');
  assert.equal(request.groupId,'job/j1/task/producer');
  assert.equal(request.eventTemplate.data.interactive.executionId,'e1');
});
test('Neo sends execution-bound review without a revision command',async()=>{
  const f=withOp(op),steps=[];
  try{
    const result=await watchAndNotify(f.id,{directory:f.dir,initialIdentity:{jobId:'j1',taskId:'producer',executionId:'e1'},
      onReady:async()=>{throw Error('No revision binding');},
      notify:async request=>{steps.push('notify');assert.equal(request.id,f.id);return {stored:true,accepted:false};}});
    assert.deepEqual(steps,['notify']);assert.equal(result.notified,true);
  }finally{f.clean();}
});
test('Failed or invalid Preview is never sent to iPhone',async()=>{
  const f=withOp({state:'failed',error:'compiler unavailable'}),steps=[];
  try{
    const result=await watchAndNotify(f.id,{directory:f.dir,onFailed:async reason=>steps.push(reason),
      notify:async()=>{throw new Error('must not notify');}});
    assert.equal(result.failed,true);assert.deepEqual(steps,['compiler unavailable']);
  }finally{f.clean();}
  assert.throws(()=>buildNeoReviewRequest(randomUUID(),{...op,result:{...op.result,contentHash:'bad'}}));
});
test('Text Preview can mirror to mobile as view-only without Relay',async()=>{
  const f=withOp({...op,result:{...op.result,review:{delivery:'text'},relay:null}});
  try{
    let count=0;
    const result=await watchAndNotify(f.id,{directory:f.dir,notify:async request=>{
      count++;assert.equal(request.delivery,'text');assert.equal(request.eventTemplate,undefined);
      return {stored:true,accepted:true};}});
    assert.equal(result.notified,true);assert.equal(count,1);
  }finally{f.clean();}
});
test('Neo restart replay sends only Neo-owned pending preview, then marks delivered',async()=>{
 const {runRecordedDelivery}=await import('../markcut.mjs');
 const ops=mkdtempSync(join(tmpdir(),'neo-operations-'));
 const intents=mkdtempSync(join(tmpdir(),'neo-delivery-intents-'));
 const id=randomUUID();
 try{
  writeFileSync(join(ops,id+'.json'),JSON.stringify({...op,result:{...op.result,review:{delivery:'text'},relay:null}}));
  writeFileSync(join(intents,id+'.json'),JSON.stringify({operationId:id,status:'pending'}));
  let notifications=0;
  const notify=async()=>{notifications++;return {stored:true,accepted:true}};
  const first=await runRecordedDelivery(id,{recordDir:intents,directory:ops,notify});
  assert.equal(first.notified,true);assert.equal(notifications,1);
  assert.equal(JSON.parse(readFileSync(join(intents,id+'.json'),'utf8')).status,'delivered');
  const repeated=await runRecordedDelivery(id,{recordDir:intents,directory:ops,notify});
  assert.equal(repeated.skipped,true);assert.equal(notifications,1);
 }finally{rmSync(ops,{recursive:true,force:true});rmSync(intents,{recursive:true,force:true});}
});
test('failed delivery recovery keeps durable intent pending when failure callback is unavailable',async()=>{
 const {runRecordedDelivery}=await import('../markcut.mjs');
 const ops=mkdtempSync(join(tmpdir(),'neo-operations-'));
 const intents=mkdtempSync(join(tmpdir(),'neo-delivery-intents-'));
 const id=randomUUID();
 try{
  writeFileSync(join(ops,id+'.json'),JSON.stringify(op));
  writeFileSync(join(intents,id+'.json'),JSON.stringify({operationId:id,status:'pending',
    binding:{jobId:'j1',taskId:'producer',executionId:'e1'}}));
  await assert.rejects(runRecordedDelivery(id,{recordDir:intents,directory:ops,
    onReady:async()=>{throw Error('Relay down')},onFailed:async()=>{throw Error('Relay down')},
    notify:async()=>{throw Error('unexpected APNs')}}),/Relay down/);
  assert.equal(JSON.parse(readFileSync(join(intents,id+'.json'),'utf8')).status,'pending');
 }finally{rmSync(ops,{recursive:true,force:true});rmSync(intents,{recursive:true,force:true});}
});
test('Neo restart recovery drains all pending intents with bounded concurrency',async()=>{
 const {recordDeliveryIntent,recoverPendingDeliveries}=await import('../markcut.mjs');
 const ops=mkdtempSync(join(tmpdir(),'neo-recovery-operations-'));
 const intents=mkdtempSync(join(tmpdir(),'neo-recovery-intents-'));
 try{
  const keys=Array.from({length:7},()=>randomUUID());
  for(const key of keys){
    writeFileSync(join(ops,key+'.json'),JSON.stringify({...op,result:{...op.result,review:{delivery:'text'},relay:null}}));
    recordDeliveryIntent(key,null,intents);
  }
  let sent=0;
  const result=await recoverPendingDeliveries({recordDir:intents,directory:ops,concurrency:2,
    notify:async()=>{sent++;return {stored:true,accepted:true};}});
  assert.deepEqual(result,{pending:7,delivered:7,failed:0,skipped:0});
  assert.equal(sent,7);
 }finally{rmSync(ops,{recursive:true,force:true});rmSync(intents,{recursive:true,force:true});}
});
