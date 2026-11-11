import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {commitRunPreview,loadRunGitConfig,assertReviewCheckpoint,tagRunReview} from '../.bin/neo-run-git.mjs';
const cli=resolve(import.meta.dirname,'../.bin/neo.mjs');
const git=(dir,...args)=>execFileSync('git',['-C',dir,...args],{encoding:'utf8'}).trim();
function fixture(){
 const home=mkdtempSync(join(tmpdir(),'neo-review-gitsha-'));
 const project=join(home,'neo','vlog'),run=join(project,'runs','2026-11-07-review');
 mkdirSync(join(project,'run-template'),{recursive:true});mkdirSync(run,{recursive:true});
 const ignore='*.mp4\ninput/\noutput/\nsource-reference.json\n.neo-project-run.json\n';
 writeFileSync(join(project,'run-template','.gitignore'),ignore);
 writeFileSync(join(run,'.gitignore'),ignore);
 writeFileSync(join(run,'.neo-project-run.json'),JSON.stringify({runPath:run,project:'vlog'}));
 writeFileSync(join(run,'video.md'),'unfinished preview');
 writeFileSync(join(run,'source-reference.json'),'PRIVATE');
 mkdirSync(join(run,'output'));writeFileSync(join(run,'output','video.mp4'),'original');
 git(run,'init','-q');git(run,'add','--','.gitignore');
 git(run,'-c','user.name=Test','-c','user.email=t@x','commit','-qm','initialize');
 const cfg=loadRunGitConfig(project,{versioning:{mode:'local-git',template:'run-template'}});
 return {home,run,project,cfg};
}
test('Preview checkpoints all nonignored Run files without Stage validation',()=>{
 const f=fixture();try{
   writeFileSync(join(f.run,'unrelated.json'),'also included');
   const first=commitRunPreview(join(f.run,'video.md'));
   assert.equal(first.changed,true);
   assert.deepEqual(first.files,['unrelated.json','video.md']);
   assert.match(first.commitSha,/^[a-f0-9]{40}$/);
   assert.equal(git(f.run,'show',`${first.commitSha}:unrelated.json`),'also included');
   assert.equal(git(f.run,'ls-files').includes('source-reference.json'),false);
   assert.equal(git(f.run,'ls-files').includes('output/video.mp4'),false);
   assert.equal(commitRunPreview(join(f.run,'video.md')).commitSha,first.commitSha,'unchanged Preview reuses SHA');
   assert.equal(assertReviewCheckpoint(f.run,f.cfg,first.commitSha),first.commitSha);
   assert.equal(tagRunReview(f.run,f.cfg,{status:'review_requested',requestId:'r1',commitSha:first.commitSha}).commitSha,first.commitSha);
   writeFileSync(join(f.run,'video.md'),'changed');
   assert.throws(()=>assertReviewCheckpoint(f.run,f.cfg,first.commitSha),/uncommitted/);
   assert.notEqual(commitRunPreview(join(f.run,'video.md')).commitSha,first.commitSha);
 }finally{rmSync(f.home,{recursive:true,force:true});}
});
test('Preview rejects foreign Git repositories, symlinks and remote-backed Run',()=>{
 const f=fixture();try{
   writeFileSync(join(f.home,'out.md'),'unsafe');
   symlinkSync(join(f.home,'out.md'),join(f.run,'escape.md'));
   assert.throws(()=>commitRunPreview(join(f.run,'video.md')),/unsafe Run artifact/);
   rmSync(join(f.run,'escape.md'));
   git(f.run,'remote','add','origin','https://example.test/unsafe.git');
   assert.throws(()=>commitRunPreview(join(f.run,'video.md')),/without remotes/);
   git(f.run,'remote','remove','origin');
   assert.throws(()=>commitRunPreview(join(f.home,'out.md')));
 }finally{rmSync(f.home,{recursive:true,force:true});}
});
test('Obsolete manual checkpoint CLI is unavailable',()=>{
 const result=spawnSync(process.execPath,[cli,'project','review','checkpoint'],{encoding:'utf8'});
 assert.notEqual(result.status,0);
 assert.match(result.stderr,/usage|unknown|requires/i);
});
