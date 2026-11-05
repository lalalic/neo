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
 for(const f of ['shot-selection.schema.json','edit-decision-list.schema.json','personal-story.schema.json'])copyFileSync(join(source,'contracts',f),join(vlog,'contracts',f));
 copyFileSync(join(source,'templates/cinematic-vlog.md'),join(vlog,'templates/cinematic-vlog.md'));
 const cli=join(root,'fake-relay');writeFileSync(cli,'#!/bin/sh\nexit 0\n',{mode:0o755});
 return {root,vlog,run,cli,clean:()=>rmSync(root,{recursive:true,force:true})};
}
const write=(dir,name,content)=>{const f=join(dir,name);writeFileSync(f,typeof content==='string'?content:JSON.stringify(content));};
const call=(f,args,env={})=>spawnSync(process.execPath,[f,...args],{encoding:'utf8',env:{...process.env,...env}});

const personalNarrative='我今天原本想着出门多运动一会儿，别老坐在家里。走到小路附近，看到一条小溪，结果忍不住停下来拍照。刚觉得自己今天挺积极，手机却先把我带进了拍视频模式。拍完才发现视频才一秒多，真正的运动时间倒没多少。回头如果有人问我今天练得怎么样，我也只能说：给手机找素材这件事，我确实很努力。';
function personalStoryFixture(f){
 const story={schema_version:1,story_id:'human-story-01',title:'说好出来运动的',perspective:'first_person',narrative:personalNarrative,
 protagonist:{role:'我，一个计划运动但总被拍摄分心的人',persona_basis:[{trait:'日常户外活动和随手拍摄',origin:'creative_assumption'}]},
 arc:{everyday_goal:'出门运动一会儿',setback:'总被有趣的溪水吸引',actions:['看见小溪后停下来拍照片','随后拍了很短的视频'],outcome:'有了视频，却没运动多久',contrast:'手机素材比运动成果多'},tone:'casual-self-deprecating',
 provenance:{observed:[{claim:'小路与一条浅浅的溪流',source_id:'a'}],inferred:[{claim:'可能在户外活动途中停下',basis:'小路和向下拍的溪水镜头'}],fictionalized:[{claim:'原本想运动结果一路停下来拍摄'}]},
 beats:[{id:'b01',role:'setup',purpose:'我想好好运动',scene_intent:'用小路开始',source_ids:['a']},
 {id:'b02',role:'complication',purpose:'溪水让我停下来',scene_intent:'切到溪水画面',source_ids:['a']},
 {id:'b03',role:'payoff',purpose:'拍照比运动还积极',scene_intent:'用流水收尾',source_ids:['a']}]};
 write(f.run,'personal-story.json',story);
 write(f.run,'personal-story.md','# 说好出来运动的\n\n'+personalNarrative+'\n');
 write(f.run,'story.md','# Human story adaptation\npersonal_story_id: human-story-01\n');
 return story;
}

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
test('personal story must exist before shot planning; director/editor self-heal handoff IDs',()=>{
 const f=fixture();try{
  const tool=join(f.vlog,'scripts/validate-stage.mjs');const env={AGENTS_RELAY_CLI:f.cli};
  write(f.run,'vision-evidence.json',{stage:'visioner',summary:[{source_id:'a'}],sources:[{source_id:'a'}]});
  for(const file of ['story.md','visual-brief.md','post.md'])write(f.run,file,'test');
  write(f.run,'shot-selection.json',{schema_version:1,shots:[{id:'shotA',source_id:'missing'}]});
  let r=call(tool,['director',f.run],env);assert.equal(r.status,1);assert.match(r.stdout,/REQUIRED_ARTIFACT_MISSING/);assert.match(r.stdout,/SHOT_SOURCE_REF/);
  personalStoryFixture(f);
  write(f.run,'shot-selection.json',{schema_version:1,personal_story_id:'human-story-01',shots:[{id:'shotA',source_id:'a',story_beat_id:'absent'}]});
  r=call(tool,['director',f.run],env);assert.equal(r.status,1);assert.match(r.stdout,/SHOT_PERSONAL_STORY_BEAT/);
  write(f.run,'shot-selection.json',{schema_version:1,personal_story_id:'human-story-01',shots:[{id:'shotA',source_id:'a',story_beat_id:'b01'}]});
  r=call(tool,['director',f.run],env);assert.equal(r.status,0,r.stdout);
  write(f.run,'edit-decision-list.json',{schema_version:1,personal_story_id:'wrong',edits:[{shot_id:'shotA',source_id:'a',story_beat_id:'b02',in_seconds:0,out_seconds:1}]});
  r=call(tool,['editor',f.run],env);assert.equal(r.status,1);assert.match(r.stdout,/EDL_PERSONAL_STORY_ID/);assert.match(r.stdout,/EDL_PERSONAL_STORY_BEAT/);
  write(f.run,'edit-decision-list.json',{schema_version:1,personal_story_id:'human-story-01',edits:[{shot_id:'shotA',source_id:'a',story_beat_id:'b01',in_seconds:0,out_seconds:1}]});
  r=call(tool,['editor',f.run],env);assert.equal(r.status,0,r.stdout);
 }finally{f.clean();}
});
test('scenic-only notes and fake persona references fail; creative everyday fiction is allowed',()=>{
 const f=fixture();try{
  const tool=join(f.vlog,'scripts/validate-stage.mjs');const env={AGENTS_RELAY_CLI:f.cli};
  write(f.run,'vision-evidence.json',{stage:'visioner',summary:[{source_id:'a'}],sources:[{source_id:'a'}]});
  const story=personalStoryFixture(f);
  write(f.run,'shot-selection.json',{schema_version:1,personal_story_id:'human-story-01',shots:[{id:'shotA',source_id:'a',story_beat_id:'b01'}]});
  for(const file of ['visual-brief.md','post.md'])write(f.run,file,'test');
  story.narrative='小溪很安静。天空很美丽。';story.arc={};story.protagonist.persona_basis=[{trait:'骑过100公里的自行车',origin:'profile'}];
  story.provenance.observed=[{claim:'非常美丽的山',source_id:'invented'}];
  write(f.run,'personal-story.json',story);
  let r=call(tool,['director',f.run],env);assert.equal(r.status,1);assert.match(r.stdout,/PERSONAL_STORY_ARC/);
  assert.match(r.stdout,/PERSONAL_STORY_FACT_SOURCE/);assert.match(r.stdout,/PERSONAL_STORY_PROFILE_SOURCE/);assert.match(r.stdout,/PERSONAL_STORY_MANUSCRIPT/);
  const fixed=personalStoryFixture(f);
  r=call(tool,['director',f.run],env);assert.equal(r.status,0,r.stdout);
  assert.equal(fixed.provenance.fictionalized.length,1,'explicit fictional mishap should be accepted');
  fixed.beats=[{id:'a',role:'setup',purpose:'只有风景',scene_intent:'天空照片',source_ids:['a']},{id:'b',role:'response',purpose:'更多风景',scene_intent:'河流照片',source_ids:['a']},{id:'c',role:'payoff',purpose:'结束镜头',scene_intent:'山的照片',source_ids:['a']}];
  write(f.run,'personal-story.json',fixed);
  r=call(tool,['director',f.run],env);assert.equal(r.status,1);assert.match(r.stdout,/PERSONAL_STORY_BEATS/);
 }finally{f.clean();}
});
test('malformed personal-story fields yield actionable FAIL instead of crashing',()=>{
 const f=fixture();try{
  write(f.run,'vision-evidence.json',{stage:'visioner',summary:[{source_id:'a'}],sources:[{source_id:'a'}]});
  const story=personalStoryFixture(f);story.provenance.observed=[null];story.protagonist.persona_basis=[null];story.beats=[null,{id:'b02',role:'complication',source_ids:[null]},{id:'b03',role:'payoff',source_ids:['a']}];
  write(f.run,'personal-story.json',story);
  write(f.run,'shot-selection.json',{schema_version:1,personal_story_id:'human-story-01',shots:[{id:'shotA',source_id:'a',story_beat_id:'b01'}]});
  write(f.run,'visual-brief.md','visual treatment');write(f.run,'post.md','caption');
  const r=call(join(f.vlog,'scripts/validate-stage.mjs'),['director',f.run],{AGENTS_RELAY_CLI:f.cli});
  assert.equal(r.status,1);assert.doesNotMatch(r.stderr,/TypeError/);
  const output=JSON.parse(r.stdout);assert.equal(output.status,'FAIL');
  for(const code of ['PERSONAL_STORY_FACT_SOURCE','PERSONAL_STORY_PROFILE_SOURCE','PERSONAL_STORY_BEATS','SHOT_PERSONAL_STORY_BEAT'])
   assert.ok(output.errors.some(e=>e.code===code),code+' should be actionable');
 }finally{f.clean();}
});
test('Producer cannot replace accepted personal story ID with a scenic-only identity',()=>{
 const f=fixture();try{
  personalStoryFixture(f);write(f.run,'edit-decision-list.json',{edits:[{shot_id:'shotA'}]});
  write(f.run,'episode-input.json',{story:{personal_story_id:'scenic-montage'},scenes:[{id:'sceneA'}]});
  const r=call(join(f.vlog,'scripts/validate-stage.mjs'),['producer',f.run]);
  assert.equal(r.status,1);assert.match(r.stdout,/PRODUCER_PERSONAL_STORY_ID/);
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
