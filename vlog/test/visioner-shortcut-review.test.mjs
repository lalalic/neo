import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {reviewRequested,waitForSourceReview} from '../lib/visioner-shortcut-review.mjs';

const input={jobId:'583',taskId:'content-run',repository:'lalalic/neo',
 executionId:'123e4567-e89b-12d3-a456-426614174000',projectPath:'/fake/vlog'};
const revision='c'.repeat(40);
const setup=()=>{
 const dir=mkdtempSync(join(tmpdir(),'vlog-source-review-'));
 const manifest='{"media":[{"id":"a"}]}\n';
 writeFileSync(join(dir,'source-manifest.json'),manifest);
 return {dir,hash:createHash('sha256').update(manifest).digest('hex'),clean:()=>rmSync(dir,{recursive:true,force:true})};
};
const success=(f,{approval=true,created=true}={})=>{
 let show=0;
 const calls=[];
 const context={signal:new AbortController().signal,runCommand:async(args)=>{
  calls.push(args);
  if(args[0]==='node' || args[0]===process.execPath){
   if(args[1]?.includes('validate-stage.mjs'))return {code:0,stdout:JSON.stringify({status:'PASS'})};
   if(args[1]?.includes('visioner-review-to-md.mjs'))return {code:0,stdout:JSON.stringify({stage:'visioner',review:'NOT_REQUESTED'})};
  }
  if(args[0]==='agents-relay'&&args[1]==='task'&&args[2]==='show'){
   show++;
   if(show===1&&created)return {code:1,stderr:'Task not found'};
   return {code:0,stdout:JSON.stringify({state:'SUCCEEDED',interactiveInvocation:{
    status:approval?'approved':'changes_requested',revision,decidedAt:'2026-11-09T10:00:00Z'}})};
  }
  if(args[0]==='agents-relay'&&args[1]==='task'&&args[2]==='create'){
   writeFileSync(join(f.dir,'visioner-review-result.json'),JSON.stringify({status:'APPROVED',jobId:'583',taskId:'shortcut-content-run-visioner-review',sourceManifestSha256:f.hash,revision}));
   return {code:0,stdout:JSON.stringify({id:'shortcut-content-run-visioner-review'})};
  }
  return {code:1,stderr:'Unexpected '+args.join(' ')};
 }};
 return {context,calls};
};

test('Visioner Review is opt-in and rejects malformed owner scope',async()=>{
 const f=setup();try{
  assert.equal(await reviewRequested(f.dir),false);
  writeFileSync(join(f.dir,'review-stages.json'),'{"visioner":true,"director":true}');
  assert.equal(await reviewRequested(f.dir),true);
  writeFileSync(join(f.dir,'review-stages.json'),'{"visioner":"yes"}');
  await assert.rejects(()=>reviewRequested(f.dir),/must be true\/false/);
 }finally{f.clean();}
});

test('Visioner Shortcut creates native human Review child and waits for real approval receipt',async()=>{
 const f=setup();try{
  const {context,calls}=success(f);
  const result=await waitForSourceReview(context,f.dir,input);
  assert.equal(result.revision,revision);
  assert.equal(result.taskId,'shortcut-content-run-visioner-review');
  assert.equal(calls.filter(args=>args[1]==='task'&&args[2]==='create').length,1);
  const taskInput=readFileSync(join(f.dir,'visioner-review-task.md'),'utf8');
  assert.match(taskInput,/AWAITING_DECISION/);
  assert.match(taskInput,/visioner-review\.md/);
  assert.match(taskInput,/Never invent approval/);
 }finally{f.clean();}
});

test('Visioner Review does not treat changes requested as approval',async()=>{
 const f=setup();try{
  const {context}=success(f,{approval:false});
  await assert.rejects(()=>waitForSourceReview(context,f.dir,input),/without an approved hostInvocation/);
 }finally{f.clean();}
});

test('Visioner Review rejects missing authoritative Job identity',async()=>{
 const f=setup();try{
  const {context}=success(f);
  await assert.rejects(()=>waitForSourceReview(context,f.dir,{...input,jobId:''}),/authenticated current/);
 }finally{f.clean();}
});
