import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { assertReviewCheckpoint, loadRunGitConfig, tagRunReview } from '../.bin/neo-run-git.mjs';

const cli=resolve(import.meta.dirname,'../.bin/neo.mjs');
const projectRoot=resolve(import.meta.dirname,'../vlog');
const sha=path=>execFileSync('git',['-C',path,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
function fixture(){
 const home=mkdtempSync(join(tmpdir(),'neo-review-gitsha-'));
 const neo=join(home,'neo'),project=join(neo,'vlog'),run=join(project,'runs','2026-11-07-review');
 mkdirSync(join(project,'run-template'),{recursive:true});
 mkdirSync(run,{recursive:true});
 mkdirSync(join(project,'scripts'));
 const template=readFileSync(join(projectRoot,'run-template','.gitignore'),'utf8');
 writeFileSync(join(project,'run-template','.gitignore'),template);
 for(const file of ['README.md','AGENTS.md'])writeFileSync(join(project,file),'review fixture');
 writeFileSync(join(project,'graph.mmd'),'flowchart TD\n  a[agent:vlog-producer]\n');
 writeFileSync(join(project,'scripts','validate-stage.mjs'),`const passed=process.env.NEO_REVIEW_FIXTURE_FAIL!=='1';
console.log(JSON.stringify({status:passed?'PASS':'FAIL'}));process.exit(passed?0:1);`);
 writeFileSync(join(project,'project.run.json'),JSON.stringify({
  schemaVersion:1,input:{type:'path',path:{base:'runs',datedRunDirectory:true}},
  versioning:{mode:'local-git',template:'run-template',trackedArtifacts:['video.md','production-receipt.json']},
  stageValidation:{script:'scripts/validate-stage.mjs',agents:{'vlog-producer':'producer'}}
 }));
 writeFileSync(join(run,'video.md'),'verified synthetic video metadata');
 writeFileSync(join(run,'source-reference.json'),'PRIVATE TOKEN MUST NOT ENTER GIT');
 mkdirSync(join(run,'output'));writeFileSync(join(run,'output','video.mp4'),'synthetic only');
 const cfg=join(home,'workspace.json');
 writeFileSync(cfg,JSON.stringify({schemaVersion:1,workspaceRoot:home}));
 return {home,project,run,cfg};
}
const args=f=>['project','review','checkpoint','--project','vlog','--path',f.run,'--stage','producer'];
test('Review checkpoint runs Stage validation then commits exact allowlisted files before Preview',()=>{
 const f=fixture();
 try{
  const env={...process.env,NEO_WORKSPACE_CONFIG:f.cfg};
  const output=JSON.parse(execFileSync(process.execPath,[cli,...args(f)],{env,encoding:'utf8'}));
  assert.equal(output.status,'ready');assert.equal(output.commitSha,sha(f.run));
  assert.match(output.commitSha,/^[0-9a-f]{40}$/);
  assert.equal(execFileSync('git',['-C',f.run,'ls-files'],{encoding:'utf8'}).trim().includes('output/video.mp4'),false);
  const config=loadRunGitConfig(f.project,JSON.parse(readFileSync(join(f.project,'project.run.json'),'utf8')));
  assert.equal(assertReviewCheckpoint(f.run,config,output.commitSha),output.commitSha);
  assert.equal(tagRunReview(f.run,config,{status:'review_requested',requestId:'review-1',commitSha:output.commitSha}).commitSha,output.commitSha);
  writeFileSync(join(f.run,'video.md'),'changed after review request');
  assert.throws(()=>assertReviewCheckpoint(f.run,config,output.commitSha),/uncommitted/);
 }finally{rmSync(f.home,{recursive:true,force:true});}
});
test('A failed Stage gate refuses Commit and Preview preparation',()=>{
 const f=fixture();
 try{
  const result=spawnSync(process.execPath,[cli,...args(f)],{encoding:'utf8',
   env:{...process.env,NEO_WORKSPACE_CONFIG:f.cfg,NEO_REVIEW_FIXTURE_FAIL:'1'}});
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/Stage validation failed/);
  assert.equal(spawnSync('git',['-C',f.run,'rev-parse','--verify','HEAD'],{stdio:'ignore'}).status,128);
 }finally{rmSync(f.home,{recursive:true,force:true});}
});
test('Malformed Review checkpoints fail closed',()=>{
 const f=fixture();
 try{
  const env={...process.env,NEO_WORKSPACE_CONFIG:f.cfg};
  for(const bad of [
   [...args(f),'--stage','producer'],
   ['project','review','checkpoint','--project','vlog','--path',f.run,'--stage','publisher'],
   ['project','review','checkpoint','--project','vlog','--path',f.run,'--stage','producer','--bogus','value'],
  ]) {
   const result=spawnSync(process.execPath,[cli,...bad],{encoding:'utf8',env});
   assert.notEqual(result.status,0);
  }
 }finally{rmSync(f.home,{recursive:true,force:true});}
});
