import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,copyFileSync,rmSync,symlinkSync,existsSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
const source=resolve(import.meta.dirname,'../scripts/story-history.mjs');
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'vlog-history-'));const vlog=join(root,'vlog');
 mkdirSync(join(vlog,'scripts'),{recursive:true});mkdirSync(join(vlog,'runs'),{recursive:true});
 copyFileSync(source,join(vlog,'scripts/story-history.mjs'));
 const script=join(vlog,'scripts/story-history.mjs');
 const create=(id,title=id)=>{
  const run=join(vlog,'runs',id);mkdirSync(run,{recursive:true});
  writeFileSync(join(run,'personal-story.json'),JSON.stringify({perspective:'first_person',story_id:id,title,arc:{everyday_goal:'散步',setback:'下雨'},tags:['安静','周末'],tone:'日常'}));
  writeFileSync(join(run,'personal-story.md'),'# '+title+'\n故事正文');
  writeFileSync(join(run,'story.md'),'# '+title+'\n故事大纲');return run;
 };
 const call=(...args)=>spawnSync(process.execPath,[script,...args],{encoding:'utf8'});
 return {root,vlog,script,create,call,index:join(vlog,'runs/personal-library/history-index.json'),clean:()=>rmSync(root,{recursive:true,force:true})};
}
const success=result=>{assert.equal(result.status,0,result.stderr+result.stdout);return JSON.parse(result.stdout);};
const add=(f,run)=>success(f.call('record','--run',run));
test('uses only project-root user.md; repeated records are one searchable entry',()=>{
 const f=fixture();try{
  writeFileSync(join(f.vlog,'user.md'),'private profile');const init=success(f.call('init'));
  assert.equal(init.user,join(realpathSync(f.vlog),'user.md'));assert.equal(init.profileExists,true);
  assert.equal(existsSync(join(f.vlog,'templates/user-world.md')),false);
  const run=f.create('2026-11-07-quiet','周末散步');add(f,run);add(f,run);
  const data=JSON.parse(readFileSync(f.index));assert.equal(data.entries.length,1);
  assert.equal(data.entries[0].status,'story-ready');
  assert.equal(success(f.call('search','散步')).length,1);
  assert.equal(success(f.call('search','不存在')).length,0);
  const item=success(f.call('inspect','2026-11-07-quiet'));
  assert.equal(item.paths['personal-story.md'],join(realpathSync(run),'personal-story.md'));
 }finally{f.clean();}
});
test('rendered and archived states require corresponding actual artifacts',()=>{
 const f=fixture();try{
  const run=f.create('2026-11-07-render');
  writeFileSync(join(run,'qa.md'),'not a completed review');add(f,run);
  assert.equal(success(f.call('search'))[0].status,'story-ready');
  mkdirSync(join(run,'output'));writeFileSync(join(run,'output/finished.mp4'),'rendered placeholder');
  writeFileSync(join(run,'video.md'),'executable video');add(f,run);
  assert.equal(success(f.call('search'))[0].status,'rendered');
  writeFileSync(join(run,'archive-receipt.json'),'{}');add(f,run);
  assert.equal(success(f.call('search'))[0].status,'archived');
 }finally{f.clean();}
});
test('rebuild scans dated runs only; broken index fails closed without overwriting',()=>{
 const f=fixture();try{
  f.create('2026-11-07-first');f.create('2026-11-08-second');
  const invalid=join(f.vlog,'runs','draft');mkdirSync(invalid);writeFileSync(join(invalid,'story.md'),'# draft');
  assert.equal(success(f.call('rebuild')).indexed,2);
  writeFileSync(f.index,'{corrupt');const run=f.create('2026-11-09-third');
  const result=f.call('record','--run',run);assert.equal(result.status,1);
  assert.match(result.stderr,/HISTORY_INDEX_INVALID/);assert.equal(readFileSync(f.index,'utf8'),'{corrupt');
  assert.equal(success(f.call('rebuild')).indexed,3);
 }finally{f.clean();}
});
test('rejects a source path escaping runs through symlinks',()=>{
 const f=fixture();try{
  const outside=join(f.root,'2026-11-07-outside');mkdirSync(outside);writeFileSync(join(outside,'story.md'),'# outside');
  const linked=join(f.vlog,'runs','2026-11-07-link');symlinkSync(outside,linked,'dir');
  const result=f.call('record','--run',linked);assert.equal(result.status,1);assert.match(result.stderr,/HISTORY_INVALID_RUN/);
  assert.equal(success(f.call('rebuild')).indexed,0);
 }finally{f.clean();}
});
test('concurrent writers preserve all distinct Run IDs and no lock remains',async()=>{
 const f=fixture();try{
  const runs=Array.from({length:6},(_,i)=>f.create(`2026-11-07-parallel-${i}`));
  await Promise.all(runs.map(run=>new Promise((resolve,reject)=>{
   const child=spawn(process.execPath,[f.script,'record','--run',run],{stdio:['ignore','pipe','pipe']});
   let stderr='';child.stderr.on('data',chunk=>stderr+=chunk.toString());
   child.on('error',reject);child.on('close',code=>code===0?resolve():reject(Error('concurrent writer '+code+' '+stderr)));
  })));
  const index=JSON.parse(readFileSync(f.index));assert.equal(index.entries.length,6);
  assert.equal(new Set(index.entries.map(item=>item.runId)).size,6);
  assert.equal(existsSync(join(f.vlog,'runs/personal-library/.history.lock')),false);
 }finally{f.clean();}
});
