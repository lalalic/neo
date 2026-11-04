import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,copyFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
const source=resolve(import.meta.dirname,'..');
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'vlog-contract-'));
 const vlog=join(root,'vlog');mkdirSync(join(vlog,'scripts'),{recursive:true});mkdirSync(join(vlog,'templates'));mkdirSync(join(vlog,'assets/music'),{recursive:true});mkdirSync(join(vlog,'contracts'));
 const run=join(vlog,'runs','2026-11-04-contract');mkdirSync(join(run,'input/media'),{recursive:true});
 for(const f of ['validate-stage.mjs','preflight-template-assets.mjs'])copyFileSync(join(source,'scripts',f),join(vlog,'scripts',f));
 for(const f of ['shot-selection.schema.json','edit-decision-list.schema.json'])copyFileSync(join(source,'contracts',f),join(vlog,'contracts',f));
 copyFileSync(join(source,'templates/cinematic-vlog.md'),join(vlog,'templates/cinematic-vlog.md'));
 const cli=join(root,'fake-relay');writeFileSync(cli,'#!/bin/sh\nexit 0\n',{mode:0o755});
 return {root,vlog,run,cli,clean:()=>rmSync(root,{recursive:true,force:true})};
}
const write=(dir,name,content)=>{const f=join(dir,name);writeFileSync(f,typeof content==='string'?content:JSON.stringify(content));};
const call=(f,args,env={})=>spawnSync(process.execPath,[f,...args],{encoding:'utf8',env:{...process.env,...env}});
test('template preflight resolves declared asset files and HTTPS URLs, fails on missing file',()=>{
 const f=fixture();try{
  const tool=join(f.vlog,'scripts/preflight-template-assets.mjs');
  let r=call(tool,[]);assert.equal(r.status,1);assert.match(r.stdout,/song.vocal_file/);
  write(f.vlog,'assets/music/good-times-rynn-vocal.mp3','audio');write(f.vlog,'assets/music/good-times-rynn-instrumental.mp3','audio');
  r=call(tool,[]);assert.equal(r.status,0,r.stderr+r.stdout);assert.match(r.stdout,/'status': 'PASS'|"status": "PASS"/);
  const template=join(f.vlog,'templates/cinematic-vlog.md');
  const contents= readFileSync(template,'utf8').replace('https://artlist.io/royalty-free-music/song/good-times/133995','http://bad.test/song');
  writeFileSync(template,contents);r=call(tool,[]);assert.equal(r.status,1);assert.match(r.stdout,/invalid HTTPS URL/);
 }finally{f.clean();}
});
test('visioner contract fails closed, then passes after agent heals missing evidence',()=>{
 const f=fixture();try{
  const tool=join(f.vlog,'scripts/validate-stage.mjs');
  write(f.run,'vision-segment-index.json',{status:'SOURCE_LINKED_UNREVIEWED',sources:[{source_id:'a'}]});
  let r=call(tool,['visioner',f.run]);assert.equal(r.status,1);assert.match(r.stdout,/REQUIRED_ARTIFACT_MISSING/);
  write(f.run,'vision-evidence.json',{stage:'visioner',summary:[{source_id:'a'}]});write(f.run,'input/media/metadata.json',{a:{}});
  r=call(tool,['visioner',f.run]);assert.equal(r.status,0,r.stdout);assert.match(r.stdout,/"status": "PASS"/);
 }finally{f.clean();}
});
test('director and editor stage contracts validate existing schema plus upstream references, heal bad shot references',()=>{
 const f=fixture();try{
  const tool=join(f.vlog,'scripts/validate-stage.mjs');const env={AGENTS_RELAY_CLI:f.cli};
  write(f.run,'vision-evidence.json',{stage:'visioner',summary:[{source_id:'a'}]});
  for(const file of ['story.md','visual-brief.md','post.md'])write(f.run,file,'test');
  write(f.run,'shot-selection.json',{schema_version:1,shots:[{id:'shotA',source_id:'missing'}]});
  let r=call(tool,['director',f.run],env);assert.equal(r.status,1);assert.match(r.stdout,/SHOT_SOURCE_REF/);
  write(f.run,'shot-selection.json',{schema_version:1,shots:[{id:'shotA',source_id:'a'}]});
  r=call(tool,['director',f.run],env);assert.equal(r.status,0,r.stdout);
  write(f.run,'edit-decision-list.json',{schema_version:1,edits:[{shot_id:'bogus'}]});
  r=call(tool,['editor',f.run],env);assert.equal(r.status,1);assert.match(r.stdout,/EDL_SHOT_REF/);
  write(f.run,'edit-decision-list.json',{schema_version:1,edits:[{shot_id:'shotA',source_id:'a',in_seconds:0,out_seconds:1}]});
  r=call(tool,['editor',f.run],env);assert.equal(r.status,0,r.stdout);
 }finally{f.clean();}
});

test('Producer TTS and render are Stage-local, never initial template preflight prerequisites',()=>{
 const f=fixture();try{
  write(f.vlog,'assets/music/good-times-rynn-vocal.mp3','audio');write(f.vlog,'assets/music/good-times-rynn-instrumental.mp3','audio');
  const preflight=call(join(f.vlog,'scripts/preflight-template-assets.mjs'),[]);assert.equal(preflight.status,0,preflight.stdout);
  const result=call(join(f.vlog,'scripts/validate-stage.mjs'),['producer',f.run]);
  assert.equal(result.status,1);assert.match(result.stdout,/REQUIRED_ARTIFACT_MISSING/);
  assert.match(result.stdout,/EPISODE_SCENES/);
 }finally{f.clean();}
});
test('specialist review validates its own verdict and revision, repairs in same Stage',()=>{
 const f=fixture();try{
  mkdirSync(join(f.run,'reviews'),{recursive:true});
  const tool=join(f.vlog,'scripts/validate-stage.mjs');
  write(f.run,'reviews/market.md','A general opinion');
  let result=call(tool,['market',f.run]);assert.equal(result.status,1);assert.match(result.stdout,/REVIEW_VERDICT/);
  write(f.run,'reviews/market.md','Revision r1: CHANGE_REQUIRED. Actual playback shows missing ending.');
  result=call(tool,['market',f.run]);assert.equal(result.status,0,result.stdout);
 }finally{f.clean();}
});
