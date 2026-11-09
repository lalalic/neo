import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,copyFileSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const source=resolve(import.meta.dirname,'..');
function fixture(runName='2026-11-04-contract'){
 const root=mkdtempSync(join(tmpdir(),'vlog-contract-'));
 const vlog=join(root,'vlog');mkdirSync(join(vlog,'scripts'),{recursive:true});mkdirSync(join(vlog,'templates'));mkdirSync(join(vlog,'assets/music'),{recursive:true});mkdirSync(join(vlog,'contracts'));
 const run=join(vlog,'runs',runName);mkdirSync(join(run,'input/media'),{recursive:true});
 for(const f of ['validate-stage.mjs','story-history.mjs'])copyFileSync(join(source,'scripts',f),join(vlog,'scripts',f));
 for(const f of ['shot-selection.schema.json','edit-decision-list.schema.json','personal-story.schema.json','route-intent.schema.json'])copyFileSync(join(source,'contracts',f),join(vlog,'contracts',f));
 copyFileSync(join(source,'templates/cinematic-vlog.md'),join(vlog,'templates/cinematic-vlog.md'));
 const cli=join(root,'fake-relay');writeFileSync(cli,'#!/bin/sh\nexit 0\n',{mode:0o755});
 writeFileSync(join(run,'route-intent.json'),JSON.stringify({schemaVersion:1,decision:'omit',reason:'No trusted GPS route'}));
 return {root,vlog,run,cli,clean:()=>rmSync(root,{recursive:true,force:true})};
}
const write=(dir,name,content)=>{const f=join(dir,name);writeFileSync(f,typeof content==='string'?content:JSON.stringify(content));};
const call=(f,args,env={})=>spawnSync(process.execPath,[f,...args],{encoding:'utf8',env:{...process.env,...env}});

const hash=value=>createHash('sha256').update(value).digest('hex');
function editorReady(f){
 mkdirSync(join(f.run,'assets'),{recursive:true});
 write(f.run,'assets/music.m4a','audio bytes');
 write(f.run,'episode-input.json',{geo:{required:false},music:{path:'assets/music.m4a'},scenes:[]});
 write(f.run,'music-plan.json',{track:'assets/music.m4a'});
 const md='# video\nwidth:1080 height:1920 fps:30 layout:series\n';
 write(f.run,'video.md',md);
}
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

test('new Vlogs require a real-source-backed primary channel pillar, old Runs remain compatible',()=>{
 const f=fixture('2026-11-09-channel-pillar');
 try{
  const tool=join(f.vlog,'scripts/validate-stage.mjs'),env={AGENTS_RELAY_CLI:f.cli};
  write(f.run,'vision-evidence.json',{stage:'visioner',sources:[{source_id:'a'}],summary:[{source_id:'a'}]});
  const story=personalStoryFixture(f);
  const errors=()=>JSON.parse(call(tool,['director',f.run],env).stdout).errors.map(x=>x.code);
  assert.ok(errors().includes('DIRECTOR_CHANNEL_FOCUS'));
  story.channel_focus={primary:'all_six',viewer_reason:'中国观众想知道加拿大的生活是什么样子',source_ids:['a']};
  write(f.run,'personal-story.json',story);
  assert.ok(errors().includes('DIRECTOR_CHANNEL_FOCUS'));
  story.channel_focus.primary='travel_explore';story.channel_focus.source_ids=['invented'];
  write(f.run,'personal-story.json',story);
  assert.ok(errors().includes('DIRECTOR_CHANNEL_FOCUS'));
  story.channel_focus.source_ids=['a'];
  write(f.run,'personal-story.json',story);
  assert.ok(!errors().includes('DIRECTOR_CHANNEL_FOCUS'));
  const legacy=fixture('2026-11-08-channel-pillar');
  try{
   write(legacy.run,'vision-evidence.json',{stage:'visioner',sources:[{source_id:'a'}],summary:[{source_id:'a'}]});
   personalStoryFixture(legacy);
   const out=JSON.parse(call(join(legacy.vlog,'scripts/validate-stage.mjs'),['director',legacy.run],{AGENTS_RELAY_CLI:legacy.cli}).stdout);
   assert.ok(!out.errors.some(x=>x.code==='DIRECTOR_CHANNEL_FOCUS'));
  }finally{legacy.clean();}
 }finally{f.clean();}
});

test('new Run Director Hook options must each declare a channel pillar with real source evidence',()=>{
 const f=fixture('2026-11-09-hook-pillar-gate');
 try{
  const tool=join(f.vlog,'scripts/validate-stage.mjs'),env={AGENTS_RELAY_CLI:f.cli};
  write(f.run,'vision-evidence.json',{stage:'visioner',sources:[{source_id:'a'}],summary:[{source_id:'a'}]});
  const story=personalStoryFixture(f);
  story.channel_focus={primary:'travel_explore',viewer_reason:'普通观众想看看加拿大的真实生活体验',source_ids:['a']};
  write(f.run,'personal-story.json',story);
  const hooks={schema_version:2,recommended_hook_id:'walk',hooks:[
   {id:'walk',primary_pillar:'travel_explore',viewer_reason:'好奇加拿大散步的真实小发现',media:[{source_id:'a',start_seconds:0,end_seconds:5}]},
   {id:'new',primary_pillar:'ai',viewer_reason:'想了解AI软件如何用来剪真实生活视频',media:[{source_id:'a',start_seconds:2,end_seconds:6}]}]};
  const errors=()=>JSON.parse(call(tool,['director',f.run],env).stdout).errors.map(x=>x.code);
  write(f.run,'director-hooks.json',hooks);
  assert.ok(!errors().includes('DIRECTOR_HOOK_PILLARS'));
  hooks.hooks[1].primary_pillar='random'; write(f.run,'director-hooks.json',hooks);
  assert.ok(errors().includes('DIRECTOR_HOOK_PILLARS'));
  hooks.hooks[1].primary_pillar='ai'; hooks.hooks[1].media=[{source_id:'invented'}]; write(f.run,'director-hooks.json',hooks);
  assert.ok(errors().includes('DIRECTOR_HOOK_PILLARS'));
  hooks.hooks[1].media=[{source_id:'a'}];hooks.hooks[0].viewer_reason='';write(f.run,'director-hooks.json',hooks);
  assert.ok(errors().includes('DIRECTOR_HOOK_PILLARS'));
  hooks.hooks[0].viewer_reason='普通观众想看看加拿大散步的真实生活';hooks.hooks[0].primary_pillar='midlife'; write(f.run,'director-hooks.json',hooks);
  assert.ok(errors().includes('DIRECTOR_HOOK_PILLARS'));
 }finally{f.clean();}
});

test('Editor validates sourceDuration versus story-paced timelineDuration instead of equating them',()=>{
 const f=fixture();try{
  const tool=join(f.vlog,'scripts/validate-stage.mjs');const env={AGENTS_RELAY_CLI:f.cli,MARKCUT_CLI:f.cli};
  write(f.run,'vision-evidence.json',{stage:'visioner',summary:[{source_id:'a'}],sources:[{source_id:'a'}]});
  personalStoryFixture(f);editorReady(f);
  write(f.run,'shot-selection.json',{schema_version:1,personal_story_id:'human-story-01',shots:[{id:'shotA',source_id:'a',story_beat_id:'b01'}]});
  const edit={shot_id:'shotA',sceneId:'shotA',source_id:'a',source_hash:'original',story_beat_id:'b01',beat:'setup',sourceType:'video',in_seconds:0,out_seconds:1.55,sourceDuration:1.55,playbackSpeed:.5,timelineDuration:1.55,target_duration_seconds:1.55};
  const edl={schema_version:1,personal_story_id:'human-story-01',edits:[edit]};
  write(f.run,'edit-decision-list.json',edl);
  let result=call(tool,['editor',f.run],env);assert.equal(result.status,1);assert.match(result.stdout,/EDL_TIMELINE_DURATION/);
  edit.timelineDuration=edit.target_duration_seconds=3.10;delete edit.sourceDuration;write(f.run,'edit-decision-list.json',edl);
  result=call(tool,['editor',f.run],env);assert.equal(result.status,1);assert.match(result.stdout,/EDL_TREATMENT_FIELDS/);
  edit.sourceDuration=1.55;write(f.run,'edit-decision-list.json',edl);
  result=call(tool,['editor',f.run],env);assert.equal(result.status,0,result.stdout);
 }finally{f.clean();}
});

test('Editor may select a new source-bound human reaction only with explicit creative rationale',()=>{
 const f=fixture();try{
  const tool=join(f.vlog,'scripts/validate-stage.mjs');const env={AGENTS_RELAY_CLI:f.cli,MARKCUT_CLI:f.cli};
  const sourceHash='b'.repeat(64);
  write(f.run,'vision-evidence.json',{stage:'visioner',summary:[{source_id:'a'},{source_id:'b'}],sources:[{source_id:'a'},{source_id:'b',source_sha256:sourceHash}]});
  personalStoryFixture(f);editorReady(f);
  write(f.run,'shot-selection.json',{schema_version:1,personal_story_id:'human-story-01',shots:[{id:'shotA',source_id:'a',story_beat_id:'b01'}]});
  const edit={shot_id:'editor-berry-reaction',source_id:'b',source_hash:sourceHash,story_beat_id:'b02',beat:'reaction',sourceType:'video',in_seconds:4,out_seconds:6.5,sourceDuration:2.5,playbackSpeed:1,timelineDuration:2.5,target_duration_seconds:2.5};
  write(f.run,'edit-decision-list.json',{schema_version:1,personal_story_id:'human-story-01',edits:[edit]});
  let r=call(tool,['editor',f.run],env);assert.equal(r.status,1);assert.match(r.stdout,/EDL_EDITOR_REASON/);
  edit.editor_reason='Replacing a redundant scenic cut with a genuine person reacting to berries';
  write(f.run,'edit-decision-list.json',{schema_version:1,personal_story_id:'human-story-01',edits:[edit]});
  r=call(tool,['editor',f.run],env);assert.equal(r.status,0,r.stdout);
  edit.source_hash='wrong';write(f.run,'edit-decision-list.json',{schema_version:1,personal_story_id:'human-story-01',edits:[edit]});
  r=call(tool,['editor',f.run],env);assert.equal(r.status,1);assert.match(r.stdout,/EDL_SOURCE_SHA/);
  edit.source_hash=sourceHash;edit.source_id='invented';write(f.run,'edit-decision-list.json',{schema_version:1,personal_story_id:'human-story-01',edits:[edit]});
  r=call(tool,['editor',f.run],env);assert.equal(r.status,1);assert.match(r.stdout,/EDL_SOURCE_REF/);
 }finally{f.clean();}
});

test('new Vlogs enforce BGM 0.7 and verified Worknode ChatTTS male audio, no local fallback',()=>{
 const f=fixture('2026-11-07-worknode-policy');try{
  const tool=join(f.vlog,'scripts/validate-stage.mjs');const env={AGENTS_RELAY_CLI:f.cli,MARKCUT_CLI:f.cli};
  write(f.run,'vision-evidence.json',{stage:'visioner',summary:[{source_id:'a'}],sources:[{source_id:'a'}]});
  personalStoryFixture(f);editorReady(f);
  write(f.run,'shot-selection.json',{schema_version:1,personal_story_id:'human-story-01',shots:[{id:'shotA',source_id:'a',story_beat_id:'b01'}]});
  write(f.run,'edit-decision-list.json',{schema_version:1,personal_story_id:'human-story-01',edits:[{shot_id:'shotA',source_id:'a',story_beat_id:'b01',in_seconds:0,out_seconds:1}]});
  const folder=join(f.run,'assets/narration/chattts-male');mkdirSync(folder,{recursive:true});
  const audio=join(folder,'line.m4a');
  const made=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','sine=frequency=440:duration=1',
    '-c:a','aac','-b:a','96k',audio],{encoding:'utf8'});
  assert.equal(made.status,0,made.stderr);
  write(f.run,'episode-input.json',{geo:{required:false},music:{path:'assets/music.m4a'},scenes:[{
    id:'opening',audioIntent:'narration',audioPath:'assets/narration/chattts-male/line.m4a',audioDuration:1.0}]});
  let md='# video\nwidth:1080 height:1920 fps:30 layout:series\n- audio src:assets/music.m4a isBackground:true volume:0.5\n## opening\nlayout:parallel\n- audio src:assets/narration/chattts-male/line.m4a duration:1 volume:1\n';
  write(f.run,'video.md',md);
  let result=call(tool,['editor',f.run],env);
  assert.equal(result.status,1);
  assert.match(result.stdout,/EDITOR_BGM_07/);
  assert.match(result.stdout,/EDITOR_WORKNODE_CHATTTS/);
  md=md.replace('volume:0.5','volume:0.7');write(f.run,'video.md',md);
  const fake={status:'COMPLETE',provider:'Local Tingting',voice:'female',scenes:[{name:'line',bytes:statSync(audio).size}]};
  write(f.run,'assets/narration/chattts-male/worknode-result.json',fake);
  result=call(tool,['editor',f.run],env);assert.equal(result.status,1);
  assert.match(result.stdout,/EDITOR_WORKNODE_CHATTTS/);
  const valid={...fake,provider:'Worknode ChatTTS 0.2.5 + OpenVoice V2 normal male voice',voice:'male'};
  write(f.run,'assets/narration/chattts-male/worknode-result.json',valid);
  result=call(tool,['editor',f.run],env);
  assert.equal(result.status,0,result.stdout);
  write(f.run,'video.md',md.replace('src:assets/narration/chattts-male/line.m4a','src:assets/music.m4a'));
  result=call(tool,['editor',f.run],env);assert.equal(result.status,1);
  assert.match(result.stdout,/EDITOR_VOICE_TIMELINE/);
  write(f.run,'video.md',md);
  valid.scenes[0].bytes=1;write(f.run,'assets/narration/chattts-male/worknode-result.json',valid);
  result=call(tool,['editor',f.run],env);assert.equal(result.status,1);
  assert.match(result.stdout,/EDITOR_VOICE_PROVENANCE/);
 }finally{f.clean();}
});

test('visioner contract fails closed, then passes after agent heals missing evidence',()=>{
 const f=fixture();try{
  const tool=join(f.vlog,'scripts/validate-stage.mjs');
  let r=call(tool,['visioner',f.run]);assert.equal(r.status,1);assert.match(r.stdout,/REQUIRED_ARTIFACT_MISSING/);
  const metadata={a:{}};write(f.run,'input/media/metadata.json',metadata);
  const sourceManifest={media:[{id:'a',path:'a.mov',sha256:'original-hash'}]};
  write(f.run,'source-manifest.json',sourceManifest);
  const validEvidence={stage:'visioner',summary:[{source_id:'a'}],sources:[{source_id:'a',source_sha256:'original-hash'}],observations:[],
   manifest_hash:hash(JSON.stringify(sourceManifest)),markcut_metadata_sha256:hash(JSON.stringify(metadata))};
  write(f.run,'vision-evidence.json',validEvidence);
  mkdirSync(join(f.run,'input/media/.normalized'));
  write(f.run,'input/media/.normalized/a_0to1.mp4','tiny understanding bytes');
  write(f.run,'vision-normalized-manifest.json',{schemaVersion:1,
   profile:'markcut-vision-normalized-v1',usage:'vision-understanding-only',
   sourceManifestSha256:hash(JSON.stringify(sourceManifest)),sourceTimeAuthority:'original',
   sourceGpsAuthority:'original-private-manifest',sources:[{sourceId:'a',sourceSha256:'original-hash',
    originalPath:'input/media/a.mov',normalizedPath:'input/media/.normalized/a_0to1.mp4',
    normalizedBytes:Buffer.byteLength('tiny understanding bytes'),maxDimension:360,sampled:false}]});
  r=call(tool,['visioner',f.run]);assert.equal(r.status,0,r.stdout);assert.match(r.stdout,/"status": "PASS"/);
  write(f.run,'vision-evidence.json',{...validEvidence,manifest_hash:'0'.repeat(64)});
  r=call(tool,['visioner',f.run]);assert.equal(r.status,1);assert.match(r.stdout,/VISION_SOURCE_PROVENANCE/);
  write(f.run,'vision-evidence.json',{...validEvidence,sources:[{source_id:'a',source_sha256:'tampered'}]});
  r=call(tool,['visioner',f.run]);assert.equal(r.status,1);assert.match(r.stdout,/VISION_SOURCE_IDENTITY/);
 }finally{f.clean();}
});
test('personal story must exist before shot planning; director/editor self-heal handoff IDs',()=>{
 const f=fixture();try{
  const tool=join(f.vlog,'scripts/validate-stage.mjs');const env={AGENTS_RELAY_CLI:f.cli,MARKCUT_CLI:f.cli};
  write(f.run,'vision-evidence.json',{stage:'visioner',summary:[{source_id:'a'}],sources:[{source_id:'a'}]});
  for(const file of ['story.md','visual-brief.md','post.md'])write(f.run,file,'test');
  write(f.run,'shot-selection.json',{schema_version:1,shots:[{id:'shotA',source_id:'missing'}]});
  let r=call(tool,['director',f.run],env);assert.equal(r.status,1);assert.match(r.stdout,/REQUIRED_ARTIFACT_MISSING/);assert.match(r.stdout,/SHOT_SOURCE_REF/);
  personalStoryFixture(f);
  write(f.run,'shot-selection.json',{schema_version:1,personal_story_id:'human-story-01',shots:[{id:'shotA',source_id:'a',story_beat_id:'absent'}]});
  r=call(tool,['director',f.run],env);assert.equal(r.status,1);assert.match(r.stdout,/SHOT_PERSONAL_STORY_BEAT/);
  write(f.run,'shot-selection.json',{schema_version:1,personal_story_id:'human-story-01',shots:[{id:'shotA',source_id:'a',story_beat_id:'b01'}]});
  r=call(tool,['director',f.run],env);assert.equal(r.status,0,r.stdout);
  const historyPath=join(f.vlog,'runs/.story-history/history-index.json');
  assert.equal(JSON.parse(readFileSync(historyPath,'utf8')).entries.length,1,'successful Director gets indexed');
  writeFileSync(historyPath,'{corrupt-index');
  r=call(tool,['director',f.run],env);
  assert.equal(r.status,0,'history failure must not fail creative stage: '+r.stdout);
  assert.match(r.stdout,/HISTORY_INDEX_UPDATE_FAILED/);
  assert.equal(readFileSync(historyPath,'utf8'),'{corrupt-index','broken index must not be silently reset');
  write(f.run,'edit-decision-list.json',{schema_version:1,personal_story_id:'wrong',edits:[{shot_id:'shotA',source_id:'a',story_beat_id:'b02',in_seconds:0,out_seconds:1}]});
  r=call(tool,['editor',f.run],env);assert.equal(r.status,1);assert.match(r.stdout,/EDL_PERSONAL_STORY_ID/);assert.match(r.stdout,/EDL_EDITOR_REASON/);
  write(f.run,'edit-decision-list.json',{schema_version:1,personal_story_id:'human-story-01',edits:[{shot_id:'shotA',source_id:'a',story_beat_id:'b01',in_seconds:0,out_seconds:1}]});
  editorReady(f);r=call(tool,['editor',f.run],env);assert.equal(r.status,0,r.stdout);
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
  fixed.beats=[{id:'a',role:'setup',purpose:'只有风景',scene_intent:'天空照片',source_ids:['a']},{id:'b',role:'payoff',purpose:'更多风景',scene_intent:'河流照片',source_ids:['a']},{id:'c',role:'payoff',purpose:'结束镜头',scene_intent:'山的照片',source_ids:['a']}];
  write(f.run,'personal-story.json',fixed);
  r=call(tool,['director',f.run],env);assert.equal(r.status,1);assert.match(r.stdout,/PERSONAL_STORY_BEATS/);
 }finally{f.clean();}
});
test('a complete quiet exploration without setback or contrast passes Director and Editor',()=>{
 const f=fixture();try{
  const tool=join(f.vlog,'scripts/validate-stage.mjs');const env={AGENTS_RELAY_CLI:f.cli,MARKCUT_CLI:f.cli};
  write(f.run,'vision-evidence.json',{stage:'visioner',summary:[{source_id:'a'}],sources:[{source_id:'a'}]});
  const story=personalStoryFixture(f);
  delete story.arc.setback;delete story.arc.contrast;
  story.arc.everyday_goal='出门看看加拿大社区周末有什么新鲜事';
  story.arc.actions=['沿小路散步并观察路边变化','在溪水旁停留了一会儿'];
  story.arc.outcome='发现平常走过的小路还有值得讲给朋友听的小细节';
  story.beats[1]={...story.beats[1],role:'development',purpose:'人在路边发现有趣的小细节'};
  write(f.run,'personal-story.json',story);
  for(const name of ['visual-brief.md','post.md'])write(f.run,name,'test');
  write(f.run,'shot-selection.json',{schema_version:1,personal_story_id:'human-story-01',shots:[{id:'shotA',source_id:'a',story_beat_id:'b01'}]});
  let r=call(tool,['director',f.run],env);assert.equal(r.status,0,r.stdout);
  editorReady(f);
  write(f.run,'edit-decision-list.json',{schema_version:1,personal_story_id:'human-story-01',edits:[{shot_id:'shotA',source_id:'a',story_beat_id:'b01',in_seconds:0,out_seconds:1}]});
  r=call(tool,['editor',f.run],env);assert.equal(r.status,0,r.stdout);
 }finally{f.clean();}
});
test('Canadian audience context requires a source reference, even when route is omitted',()=>{
 const f=fixture();try{
  const tool=join(f.vlog,'scripts/validate-stage.mjs');const env={AGENTS_RELAY_CLI:f.cli};
  write(f.run,'vision-evidence.json',{stage:'visioner',summary:[{source_id:'a'}],sources:[{source_id:'a'}]});
  personalStoryFixture(f);
  write(f.run,'shot-selection.json',{schema_version:1,personal_story_id:'human-story-01',shots:[{id:'shotA',source_id:'a',story_beat_id:'b01'}]});
  for(const name of ['post.md','visual-brief.md'])write(f.run,name,'test');
  write(f.run,'route-intent.json',{schemaVersion:1,decision:'omit',reason:'Single stationary point',audienceContext:[{fact:'附近属于加拿大某省'}]});
  let r=call(tool,['director',f.run],env);assert.equal(r.status,1);assert.match(r.stdout,/DIRECTOR_AUDIENCE_CONTEXT_SOURCE/);
  write(f.run,'route-intent.json',{schemaVersion:1,decision:'omit',reason:'Single stationary point',audienceContext:[{fact:'附近属于加拿大某省',sourceRef:'source-manifest.json#a'}]});
  r=call(tool,['director',f.run],env);assert.equal(r.status,0,r.stdout);
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
test('Producer refuses incomplete render receipt; Editor owns story decisions',()=>{
 const f=fixture();try{
  write(f.run,'video.md','# video\n');
  const r=call(join(f.vlog,'scripts/validate-stage.mjs'),['producer',f.run],{MARKCUT_CLI:f.cli});
  assert.equal(r.status,1);assert.match(r.stdout,/production-receipt.json/);
  assert.match(r.stdout,/REQUIRED_ARTIFACT_MISSING/);
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
