import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runVisioner,inferenceArgs} from './run-visioner.mjs';
import {segment} from './deepseek-segment.mjs';
import {DeepSeekSession} from './webhelm-deepseek.mjs';

test('fresh inference passes all three generic Markcut hooks, preserves exact context and fails closed for offline requests',async t=>{
 const folder=mkdtempSync(join(tmpdir(),'shared-visioner-'));t.after(()=>rmSync(folder,{recursive:true,force:true}));
 writeFileSync(join(folder,'a.mov'),'fixture');
 const calls=[];const execute=async args=>{
   calls.push(args);
   writeFileSync(join(folder,'metadata.json'),JSON.stringify({'a.mov':{normalized:null,perception:{desc:'test',segments:{'0to1000':{description:'test'}}}}}));
 };
 const base={folder,execute,contextText:'context with ` and $()'};
 await assert.rejects(runVisioner(base),/authorized external transfer/);
 assert.equal(calls.length,0);
 const r=await runVisioner({...base,externalTransferAuthorized:true});
 assert.deepEqual(calls[0],['markcut','vision',folder,'--instruct',base.contextText,...inferenceArgs()]);
 assert.match(calls[0][calls[0].indexOf('--itt')+1],/deepseek-infer\.mjs/);
 assert.match(calls[0][calls[0].indexOf('--agent')+1],/deepseek-segment\.mjs.*--prompt \{prompt\}/);
 assert.equal(r.markcut.invoked,true);
 assert.equal((await runVisioner(base)).markcut.reused,true);
 assert.equal(calls.length,1);
});
test('text segmentation rejects nonobject responses and closes owned session',()=>{
 let closes=0,starts=0;
 const session={start(){starts++},close(){closes++},completeText(){return '{"0to1000":{"description":"test"}}'}};
 assert.equal(segment('test',session),'{"0to1000":{"description":"test"}}');
 for(const bad of ['3','[]','null','not JSON']){
  assert.throws(()=>segment('test',{...session,completeText(){return bad}}),/JSON/);
 }
 assert.equal(closes,5);assert.equal(starts,5);
});
test('text DeepSeek action submits once, resumes pending without resending, and releases owned lease',t=>{
 const dir=mkdtempSync(join(tmpdir(),'segment-receipt-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const calls=[];
 const runner=(_cmd,args)=>{
  if(args[0]==='session'){
   calls.push(args.slice(0,2));
   return JSON.stringify({session_id:'owned'});
  }
  const cfg=JSON.parse(readFileSync(args[args.indexOf('--config')+1],'utf8'));
  calls.push([args[3],cfg]);
  const value=cfg.resume?{status:'completed',answer:'{}'}:{status:'pending',thread_id:'test-thread'};
  return JSON.stringify({result:{ok:true,value}});
 };
 const s=new DeepSeekSession({runner});s.start();
 assert.equal(s.completeText('test',dir),'{}');s.close();
 assert.equal(calls[1][0],'new-thread');
 assert.deepEqual(calls[1][1],{message:'test',response_format:'json',timeout_seconds:120});
 assert.deepEqual(calls[2][1],{resume:true,thread_id:'test-thread',timeout_seconds:45});
 assert.deepEqual(calls.at(-1),['session','stop']);
});
