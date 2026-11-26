import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {inferCodex,parseInferArgs} from './codex-infer.mjs';

const route={selection:{adapter:'codex'},routing:{profile:'vision-low',provider:'openai',model:'gpt-6-luna',reasoning:'low'}};
test('uses shared router with low reasoning and no private prompt or paths; pins selected route and attaches all images',t=>{
 const d=mkdtempSync(join(tmpdir(),'vision-codex-test-'));t.after(()=>rmSync(d,{recursive:true,force:true}));
 const a=join(d,'a.png'),b=join(d,'b.png');writeFileSync(a,'fixture');writeFileSync(b,'fixture');
 let calls=0,owned;
 const runner=(cmd,args,opts)=>{
   calls++;
   if(cmd==='agents-relay'){
     assert.deepEqual(args,['route','--input-file','-']);
     const req=JSON.parse(opts.input);assert.equal(req.routingConstraints.reasoning,'low');
     assert.deepEqual(req.eligibleProfiles,['vision-low']);assert.deepEqual(req.taskFacts.task.taskCapabilities,['vision']);
     assert.ok(!opts.input.includes('private')&&!opts.input.includes(a));return {status:0,stdout:JSON.stringify(route)};
   }
   assert.equal(cmd,'codex');assert.equal(args[args.indexOf('-p')+1],'vision-low');assert.equal(args[args.indexOf('-m')+1],'gpt-6-luna');
   assert.ok(args.includes('model_reasoning_effort="low"'));assert.ok(args.includes('read-only'));assert.ok(args.includes(a)&&args.includes(b));
   assert.ok(opts.input.includes('private prompt'));owned=opts.cwd;
   writeFileSync(args[args.indexOf('-o')+1],'Observed red and blue.');return {status:0};
 };
 assert.equal(inferCodex({prompt:'private prompt',inputs:[a,b],profiles:'vision-low',runner,report:()=>{}}),'Observed red and blue.');
 assert.equal(calls,2);assert.equal(existsSync(owned),false);
});
test('text segmentation validates structured output; never attaches dummy image or retries',()=>{
 for(const [answer,ok] of [['{"0to1000":{"description":"test"}}',true],['3',false],['[]',false],['null',false],['not JSON',false]]){
   let calls=0;
   const runner=(cmd,args,opts)=>{
     calls++;
     if(cmd==='agents-relay'){assert.deepEqual(JSON.parse(opts.input).taskFacts.task.taskCapabilities,['text']);return {status:0,stdout:JSON.stringify(route)}}
     assert.ok(!args.includes('-i'));writeFileSync(args[args.indexOf('-o')+1],answer);return {status:0};
   };
   const run=()=>inferCodex({prompt:'segment',text:true,profiles:'vision-low',runner,report:()=>{}});
   if(ok)assert.equal(run(),answer);else assert.throws(run,/JSON/);
   assert.equal(calls,2);
 }
});
test('ineligible or high reasoning route fails before Codex; inference failure does not fall back',()=>{
 let calls=0;
 assert.throws(()=>inferCodex({prompt:'segment',text:true,profiles:'vision-low',report:()=>{},runner:()=>{
   calls++;return {status:0,stdout:JSON.stringify({...route,routing:{...route.routing,reasoning:'high'}})}
 }}),/eligible low-reasoning/);assert.equal(calls,1);
 calls=0;
 assert.throws(()=>inferCodex({prompt:'segment',text:true,profiles:'vision-low',report:()=>{},runner:(cmd)=>{
   calls++;return cmd==='agents-relay'?{status:0,stdout:JSON.stringify(route)}:{status:1}
 }}),/inference failed/);assert.equal(calls,2);
 assert.deepEqual(parseInferArgs(['--input','a.png','b.png','--prompt','x']),{inputs:['a.png','b.png'],prompt:'x',text:false});
});
