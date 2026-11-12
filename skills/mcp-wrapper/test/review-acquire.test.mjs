import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {preserveRequest,acquireReviews,importLegacyInbox,recordPath,markDeliveryStatus} from '../review-delivery.mjs';

const request=(id=randomUUID())=>({id,title:'A media review',contentHash:'a'.repeat(64),revisionId:'v1',delivery:'text'});
test('Review delivery is durable, per-device idempotent and does not interpret decisions',()=>{
 const directory=mkdtempSync(join(tmpdir(),'neo-acquire-'));
 const phoneA=randomUUID(),phoneB=randomUUID();
 try{
  const review=request();preserveRequest(review,{directory});
  assert.deepEqual(acquireReviews({deviceId:phoneA,directory}).requests.map(x=>x.id),[review.id]);
  assert.deepEqual(acquireReviews({deviceId:phoneA,requestId:review.id,directory}).requests.map(x=>x.id),[review.id]);
  assert.deepEqual(acquireReviews({deviceId:phoneA,ackIds:[review.id],directory}).acked,[review.id]);
  assert.deepEqual(acquireReviews({deviceId:phoneA,directory}).requests,[]);
  assert.deepEqual(acquireReviews({deviceId:phoneB,directory}).requests.map(x=>x.id),[review.id]);
  assert.deepEqual(acquireReviews({deviceId:phoneA,requestId:review.id,directory}).requests.map(x=>x.id),[review.id]);
  assert.deepEqual(acquireReviews({deviceId:phoneA,ackIds:[review.id],directory}).acked,[review.id]);
  assert.throws(()=>preserveRequest({...review,title:'Conflicting content'},{directory}),/Conflicting/);
  assert.deepEqual(JSON.parse(readFileSync(recordPath(review.id,directory))).acknowledgedBy[phoneA.toLowerCase()]!==undefined,true);
 }finally{rmSync(directory,{recursive:true,force:true})}
});
test('Request acquisition validates IDs and rejects cross-directory/path-traversal injection',()=>{
 const directory=mkdtempSync(join(tmpdir(),'neo-acquire-'));
 try{
  const deviceId=randomUUID();
  for(const params of [{deviceId:'../bad'},{deviceId,requestId:'../../secret'},{deviceId,ackIds:['x']},{deviceId,ackIds:['a'.repeat(36)]}]) {
   assert.throws(()=>acquireReviews({...params,directory}),/Invalid|Valid/);
  }
  assert.deepEqual(acquireReviews({deviceId,directory}),{requests:[],acked:[],hasMore:false});
 }finally{rmSync(directory,{recursive:true,force:true})}
});
test('Import existing Master pending requests once; preserves durable delivery and original timestamps',()=>{
 const directory=mkdtempSync(join(tmpdir(),'neo-acquire-'));
 try{
  const review=request();const legacyPath=join(directory,'legacy.json'), queue=join(directory,'requests');
  const createdAt=new Date().toISOString();
  writeFileSync(legacyPath,JSON.stringify({version:1,requests:{[review.id]:{createdAt,review}}}));
  assert.deepEqual(importLegacyInbox({directory:queue,legacyPath}),{imported:1});
  assert.deepEqual(importLegacyInbox({directory:queue,legacyPath}),{imported:0});
  assert.equal(acquireReviews({directory:queue,deviceId:randomUUID()}).requests[0].createdAt,createdAt);
 }finally{rmSync(directory,{recursive:true,force:true})}
});

test('Watcher status update retains request payload and phone acknowledgement',()=>{
 const directory=mkdtempSync(join(tmpdir(),'neo-acquire-'));
 try{
  const review=request(),deviceId=randomUUID();
  preserveRequest(review,{directory});
  acquireReviews({deviceId,ackIds:[review.id],directory});
  markDeliveryStatus(review.id,'delivered',{directory});
  const entry=JSON.parse(readFileSync(recordPath(review.id,directory)));
  assert.deepEqual(entry.request,review);
  assert.equal(typeof entry.acknowledgedBy[deviceId.toLowerCase()],'string');
 }finally{rmSync(directory,{recursive:true,force:true})}
});

test('Paginated acquisition bounds MCP response; ACK advances the next batch',()=>{
 const directory=mkdtempSync(join(tmpdir(),'neo-acquire-'));
 const deviceId=randomUUID();
 try{
  for(let i=0;i<110;i++)preserveRequest(request(),{directory});
  const first=acquireReviews({deviceId,directory});
  assert.equal(first.requests.length,100);assert.equal(first.hasMore,true);
  acquireReviews({deviceId,ackIds:first.requests.map(r=>r.id),directory});
  const second=acquireReviews({deviceId,directory});
  assert.equal(second.requests.length,10);assert.equal(second.hasMore,false);
 }finally{rmSync(directory,{recursive:true,force:true})}
});

test('Unknown event types stay opaque but injected decisions are rejected',()=>{
 const directory=mkdtempSync(join(tmpdir(),'neo-acquire-'));
 try{
  const review={id:randomUUID(),title:'Review',mediaHash:'f'.repeat(64),delivery:'event',
   eventTemplate:{type:'custom.creator.review',source:'custom/agent',data:{answer:{}}}};
  preserveRequest(review,{directory});
  assert.equal(acquireReviews({directory,deviceId:randomUUID()}).requests[0].eventTemplate.type,'custom.creator.review');
  assert.throws(()=>preserveRequest({...review,id:randomUUID(),eventTemplate:{...review.eventTemplate,data:{review:{decision:'approved'}}}},{directory}),/prefilled/);
 }finally{rmSync(directory,{recursive:true,force:true})}
});
