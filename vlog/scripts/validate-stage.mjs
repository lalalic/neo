#!/usr/bin/env node
/** Domain Stage contract gate; output JSON gives current Agent actionable heal diagnostics.
 * Uses existing Relay artifact validator for JSON schemas, not a second schema implementation.
 * Deliberately does NOT inspect license, media permissions or compare hashes. */
import {readFileSync,existsSync,statSync,realpathSync,readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve,dirname,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const [stage,runArg]=process.argv.slice(2);
const stages=['visioner','director','editor','producer','final-qa','video-director','market'];
if(!stages.includes(stage)||!runArg){console.error('Usage: node scripts/validate-stage.mjs <'+stages.join('|')+'> <run>');process.exit(2);}
const run=realpathSync(resolve(runArg));const runs=realpathSync(resolve(root,'runs'));
const rel=relative(runs,run);
if(!rel||rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel))throw Error('STAGE_RUN_OUTSIDE_PROJECT');
const errors=[];const valid={};
const policyFile=resolve(run,'review-mode.json');
let noReview=false;
if(existsSync(policyFile)){
 try{
  const policy=JSON.parse(readFileSync(policyFile,'utf8'));
  noReview=policy.schemaVersion===1&&policy.mode==='private-render-test'&&policy.reviewStatus==='UNREVIEWED'&&policy.publicationAllowed===false;
  checkPolicy();
 }catch{errors.push({code:'INVALID_TEST_REVIEW_POLICY',heal:'Valid private-render-test policy required'});}
}
function checkPolicy(){if(!noReview)errors.push({code:'INVALID_TEST_REVIEW_POLICY',heal:'A review mode cannot bypass human approval without an explicit valid render-only policy'});}
function required(name){const path=resolve(run,name);try{const full=realpathSync(path);const rel=relative(run,full);if(rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel)||!statSync(full).isFile()||!statSync(full).size)throw Error('not a nonempty confined file');valid[name]=full;return full;}catch{errors.push({code:'REQUIRED_ARTIFACT_MISSING',path:name,heal:'Produce a real non-empty file in the canonical run'});return null;}}
function confinedFile(relativeName){
 if(typeof relativeName!=='string'||!relativeName||relativeName.includes('\\0'))return false;
 try {const full=realpathSync(resolve(run,relativeName));const part=relative(run,full);return part!==''&&part!=='..'&&!part.startsWith('..'+sep)&&!isAbsolute(part)&&statSync(full).isFile()&&statSync(full).size>0;}catch{return false;}
}
function renderedVideo(){
 const output=resolve(run,'output');if(!existsSync(output)||!statSync(output).isDirectory())return false;
 return readdirSync(output).some(name=>/\.(mp4|mov|m4v)$/i.test(name)&&confinedFile('output/'+name));
}
function json(name){const path=required(name);if(!path)return null;try{return JSON.parse(readFileSync(path,'utf8'));}catch{errors.push({code:'INVALID_JSON',path:name,heal:'Repair JSON syntax and rerun contract validator'});return null;}}
function check(ok,code,heal){if(!ok)errors.push({code,heal});}
function personalStory(evidence){
 const story=json('personal-story.json'),manuscript=required('personal-story.md');
 schema('personal-story.json','personal-story.schema.json');
 if(!story)return null;
 const character=story.protagonist,arc=story.arc;
 check(story.perspective==='first_person'&&typeof character?.role==='string'&&character.role.trim().length>0,
  'PERSONAL_STORY_PROTAGONIST','Make the creator/person the narrative protagonist, not scenery or a route');
 check(typeof story.narrative==='string'&&story.narrative.trim().length>=100&&
  !!arc?.everyday_goal&&!!arc?.setback&&Array.isArray(arc?.actions)&&arc.actions.length>0&&!!arc?.outcome&&!!arc?.contrast,
  'PERSONAL_STORY_ARC','Write a complete standalone first-person story: everyday goal -> setback -> actions -> human outcome/contrast, with a relatable flaw or ordinary mishap where it fits');
 if(manuscript){const markdown=readFileSync(manuscript,'utf8').replace(/\s+/g,'');
  check(markdown.includes(String(story.narrative||'').replace(/\s+/g,'')),
   'PERSONAL_STORY_MANUSCRIPT','Put the complete standalone narrative in personal-story.md; not only labels, clips or a beat list');}
 const sources=new Set((Array.isArray(evidence?.sources)?evidence.sources:Array.isArray(evidence?.summary)?evidence.summary:[]).map(x=>x?.source_id).filter(Boolean));
 const facts=story.provenance||{};
 check(Array.isArray(facts.observed)&&facts.observed.length>0&&Array.isArray(facts.inferred)&&Array.isArray(facts.fictionalized),
  'PERSONAL_STORY_PROVENANCE','Separate footage-observed facts, plausible inferred situation, and fictionalized personal incidents; fictional details are allowed when identified');
 for(const fact of Array.isArray(facts.observed)?facts.observed:[])check(sources.has(fact?.source_id),'PERSONAL_STORY_FACT_SOURCE',
  'Repair observed fact reference '+String(fact?.source_id)+' to an existing Visioner source ID');
 for(const item of Array.isArray(character?.persona_basis)?character.persona_basis:[])check(['profile','owner_context','creative_assumption'].includes(item?.origin)&&
  (item?.origin==='creative_assumption'||typeof item?.reference==='string'&&item.reference.trim().length>0),
  'PERSONAL_STORY_PROFILE_SOURCE','Use actual private profile/owner context references or explicitly label creative assumptions; do not invent personal profile facts');
 const beats=Array.isArray(story.beats)?story.beats:[];
 const roles=new Set(beats.map(x=>x?.role));const ids=new Set(beats.map(x=>x?.id));
 check(beats.length>=3&&ids.size===beats.length&&roles.has('setup')&&roles.has('complication')&&roles.has('payoff'),
  'PERSONAL_STORY_BEATS','Provide unique beat IDs for human setup, complication, and payoff; scenic-only montage is not a story');
 for(const beat of beats)for(const id of Array.isArray(beat?.source_ids)?beat.source_ids:[])check(sources.has(id),'PERSONAL_STORY_BEAT_SOURCE',
  'Repair beat '+String(beat?.id)+' source '+id+' to a real Visioner source ID; creative narration can still be fictionalized');
 return story;
}
function schema(file,name){if(!valid[file])return;
 const cmd=process.env.AGENTS_RELAY_CLI||'npx';
 const args=process.env.AGENTS_RELAY_CLI?['artifact','validate','--artifact',valid[file],'--schema',resolve(root,'contracts',name)]:['-y','agents-relay','artifact','validate','--artifact',valid[file],'--schema',resolve(root,'contracts',name)];
 const res=spawnSync(cmd,args,{encoding:'utf8',timeout:30000,maxBuffer:1048576});
 if(res.status!==0)errors.push({code:'SCHEMA_VALIDATION_FAILED',path:file,heal:(res.stderr||res.stdout||res.error?.message||'Run the existing agents-relay artifact validator and repair fields').slice(0,1800)});
}
if(stage==='visioner'){
 const evidence=json('vision-evidence.json'),index=json('vision-segment-index.json');
 check(evidence?.stage==='visioner'&&Array.isArray(evidence?.summary),'VISION_EVIDENCE_CONTRACT','Produce a Visioner summary from Markcut metadata, not new interpretation by downstream Agents');
 check(index?.status==='SOURCE_LINKED_UNREVIEWED'&&Array.isArray(index?.sources),'VISION_INDEX_CONTRACT','Regenerate the index using the existing index script');
 if(evidence&&index)check((evidence?.summary?.length??0)<=index.sources.length,'VISION_SOURCE_COUNT','Repair the source/index linkage');
 required('input/media/metadata.json');
}else if(stage==='director'){
 const evidence=json('vision-evidence.json');const story=personalStory(evidence);const shots=json('shot-selection.json');const storyPlan=required('story.md');required('visual-brief.md');required('post.md');
 check(Array.isArray(evidence?.summary),'VISIONER_HANDOFF_MISSING','Use the completed Visioner artifact without re-extraction');
 schema('shot-selection.json','shot-selection.schema.json');
 if(story&&shots){check(shots.personal_story_id===story.story_id,'SHOT_PERSONAL_STORY_ID','Bind shot-selection.json to the completed personal-story.json ID');
 const beatIds=new Set((Array.isArray(story.beats)?story.beats:[]).map(b=>b?.id));for(const shot of Array.isArray(shots.shots)?shots.shots:[])check(beatIds.has(shot?.story_beat_id),
  'SHOT_PERSONAL_STORY_BEAT','Bind shot '+String(shot?.id)+' to a valid personal-story beat before editing');
 if(storyPlan)check(readFileSync(storyPlan,'utf8').includes(story.story_id),'STORY_PLAN_PERSONAL_REF','story.md must cite personal_story_id from the full personal narrative');}
 if(shots?.shots&&evidence){const ids=new Set((evidence.sources||evidence.summary||[]).map(s=>s.source_id));for(const shot of shots.shots)check(ids.has(shot.source_id),'SHOT_SOURCE_REF','Repair selected source_id '+shot.source_id+' against Visioner source IDs');}
}else if(stage==='editor'){
 const evidence=json('vision-evidence.json');const story=personalStory(evidence);const shots=json('shot-selection.json');const edl=json('edit-decision-list.json');schema('edit-decision-list.json','edit-decision-list.schema.json');
 if(story&&edl)check(edl.personal_story_id===story.story_id,'EDL_PERSONAL_STORY_ID','Carry unchanged personal_story_id from Director to Editor');
 if(shots&&edl){const byId=new Map((shots.shots||[]).map(s=>[s.id,s]));for(const edit of edl.edits||[]){
 const shot=byId.get(edit.shot_id);check(!!shot,'EDL_SHOT_REF','Repair shot_id '+edit.shot_id+' to reference Director output');
 if(shot)check(shot.source_id===edit.source_id,'EDL_SOURCE_REF','Use Director source_id for shot '+edit.shot_id);
 if(shot)check(shot.story_beat_id===edit.story_beat_id,'EDL_PERSONAL_STORY_BEAT','Preserve Director personal-story beat for shot '+edit.shot_id);
 check(edit.out_seconds>edit.in_seconds,'EDL_TIMECODE','Set a positive source interval for '+edit.shot_id);
 if(edit.sourceType==='video' && (edit.sourceDuration!=null||edit.playbackSpeed!=null||edit.timelineDuration!=null)){
  const sourceDuration=edit.out_seconds-edit.in_seconds,speed=edit.playbackSpeed??1,screenTime=edit.timelineDuration??edit.target_duration_seconds;
  check(Number.isFinite(speed)&&speed>=.1&&speed<=4,'EDL_PLAYBACK_SPEED','Choose a finite 0.1–4× video playbackSpeed for '+edit.shot_id);
  if(edit.sourceDuration!=null)check(Math.abs(edit.sourceDuration-sourceDuration)<=.02,'EDL_SOURCE_DURATION','sourceDuration must equal source out minus in for '+edit.shot_id);
  if(screenTime!=null)check(Math.abs(screenTime-sourceDuration/speed)<=.08,'EDL_TIMELINE_DURATION','timelineDuration must equal sourceDuration/playbackSpeed for '+edit.shot_id);
 }
 if(edit.timelineDuration!=null&&edit.target_duration_seconds!=null)
  check(Math.abs(edit.timelineDuration-edit.target_duration_seconds)<=.08,'EDL_TARGET_DURATION','Target and presentation duration must agree for '+edit.shot_id);
 }}
}else if(stage==='producer'){
 const story=json('personal-story.json');const edl=json('edit-decision-list.json');const input=json('episode-input.json');json('music-plan.json');required('video.md');
 if(story&&input)check(input.story?.personal_story_id===story.story_id,'PRODUCER_PERSONAL_STORY_ID','Carry accepted personal_story_id into episode-input story; do not replace it with a scenic montage');
 check(Array.isArray(edl?.edits)&&edl.edits.length>0,'PRODUCER_EDITOR_INPUT','Use validated Editor EDL');
 check(Array.isArray(input?.scenes)&&input.scenes.length>0,'EPISODE_SCENES','Compile real scenes from accepted EDL');
 if(Array.isArray(edl?.edits)&&Array.isArray(input?.scenes)){
  const ordered=edl.edits.map(e=>e.sceneId??e.shot_id);
  check(ordered.length===input.scenes.length&&ordered.every((id,i)=>id===input.scenes[i]?.id),
   'PRODUCER_STORY_COVERAGE','Keep every Editor-selected scene in original story beat order; do not remove narrative beats to fit source runtime');
  const progression=input.story?.progression;
  if(Array.isArray(progression))check(progression.length===ordered.length&&ordered.every((id,i)=>progression[i]?.sceneId===id),
   'PRODUCER_NARRATIVE_SEQUENCE','Provide story progression across every actual media scene, in the same order');
  if(Array.isArray(progression)&&story?.beats?.length){
   const covered=new Set(edl.edits.map(e=>e.story_beat_id));
   for(const beat of story.beats)check(covered.has(beat.id),'PRODUCER_STORY_BEAT_MISSING',
    'Do not drop personal story '+beat.role+' beat '+beat.id+' to shorten media coverage');
  }
  for(let i=0;i<edl.edits.length;i++){
   const e=edl.edits[i],s=input.scenes[i];if(!s)continue;
   if(e.source_hash)check(s.sourceHash===e.source_hash,'PRODUCER_SOURCE_IDENTITY','Preserve original source hash for '+e.shot_id);
   if(e.playbackSpeed!=null||e.timelineDuration!=null){
    const speed=s.playbackSpeed??1,duration=s.timelineDuration??s.duration;
    if(e.sourceType==='video'&&e.playbackSpeed!=null)
     check(Math.abs(speed-e.playbackSpeed)<=.001,'PRODUCER_PLAYBACK_SPEED','Copy Editor playbackSpeed to Producer '+e.shot_id);
    if(e.timelineDuration!=null)check(Math.abs(duration-e.timelineDuration)<=.08,'PRODUCER_TIMELINE_DURATION','Preserve Editor narrative timelineDuration for '+e.shot_id);
   }
  }
 }
 const music=input?.music?.path;
 check(confinedFile(music),'PRODUCER_MUSIC','Build a continuous track from template-declared shared assets; do not require BGM in the initial source run');
 for(const scene of input?.scenes??[])if(scene.audioPath)check(confinedFile(scene.audioPath),'PRODUCER_VOICEOVER','Render the missing stage-local voiceover '+scene.audioPath);
 const draft=valid['video.md'];if(draft){const result=spawnSync('markcut',['verify',draft],{cwd:run,encoding:'utf8',timeout:120000});if(result.status!==0)errors.push({code:'MARKCUT_VERIFY',heal:(result.stderr||result.stdout||result.error?.message||'Fix executable Markcut DSL').slice(0,1600)});}
 // Revisions/feedback are still bound to real human interaction and review receipts; do not fabricate them here.
 check(renderedVideo(),'PRODUCER_RENDER','Render a decodable MP4/MOV into output/ before completing');
 const review=json('reviews/review.json');
 if(noReview)check(review?.status==='NOT_RUN'&&review?.humanReview==='NOT_RUN'&&review?.specialistReview==='NOT_RUN'&&review?.publicationAllowed===false,
   'UNREVIEWED_TEST_RECEIPT','Do not fabricate approvals; mark all skipped reviews NOT_RUN');
}else if(stage==='final-qa'){
 const qa=required('qa.md');const receipt=json('archive-receipt.json');
 if(noReview){
  check(!!qa && readFileSync(qa,'utf8').includes('UNREVIEWED'),'QA_UNREVIEWED_REQUIRED','Declare missing human review UNREVIEWED');
  check(receipt?.publicationAllowed===false,'QA_PRIVATE_ONLY','Final artifact must remain private and cannot be published');
 }
 check(renderedVideo(),'FINAL_QA_VIDEO','Inspect actual Producer video and report missing output as FAIL');
}else{
 const name=stage==='market'?'reviews/market.md':'reviews/video-director.md';const report=required(name);
 if(report){const value=readFileSync(report,'utf8');check(/\b(PASS|CHANGE_REQUIRED|BLOCKED)\b/.test(value),'REVIEW_VERDICT','Report an explicit video-based verdict');check(/revision/i.test(value),'REVIEW_REVISION','Identify the actual video revision in the review report');}
}
const result={schemaVersion:1,stage,status:errors.length?'FAIL':'PASS',checked:Object.keys(valid),errors};console.log(JSON.stringify(result,null,2));if(errors.length)process.exitCode=1;
