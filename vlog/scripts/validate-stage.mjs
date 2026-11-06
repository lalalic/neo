#!/usr/bin/env node
/** Domain Stage contract gate; output JSON gives current Agent actionable heal diagnostics.
 * Uses existing Relay artifact validator for JSON schemas, not a second schema implementation.
 * Deliberately does NOT inspect license, media permissions or compare hashes. */
import {readFileSync,existsSync,statSync,realpathSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {resolve,dirname,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const [stage,runArg]=process.argv.slice(2);
const stages=['visioner','director','editor','producer','publisher','final-qa','video-director','market'];
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
const fingerprint=name=>createHash('sha256').update(readFileSync(resolve(run,name))).digest('hex');
function markcutVerify(name){
 const path=valid[name];
 if(!path)return;
 const command=process.env.MARKCUT_CLI||'markcut';
 const result=spawnSync(command,['verify',path],{cwd:run,encoding:'utf8',timeout:120000});
 if(result.status!==0)errors.push({code:'MARKCUT_VERIFY',path:name,heal:(result.stderr||result.stdout||result.error?.message||'Run markcut verify on the exact file').slice(0,1800)});
}
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
 const route=json('route-intent.json');schema('route-intent.json','route-intent.schema.json');
 check(['include','omit'].includes(route?.decision)&&!!route?.reason,'DIRECTOR_ROUTE_DECISION','Describe why real GPS route helps or omit when unsupported');
 if(route?.decision==='include'){
  const sourceIds=new Set((evidence?.sources||evidence?.summary||[]).map(x=>x.source_id));
  const beatIds=new Set((story?.beats||[]).map(x=>x.id));
  check(beatIds.has(route?.insertAfterStoryBeatId)&&typeof route?.narration==='string'&&route.narration.trim().length>0,'DIRECTOR_ROUTE_STORY_BEAT','Describe route narration and bind it to real story beat');
  check(Array.isArray(route.observedStops)&&route.observedStops.length>0&&route.observedStops.every(x=>sourceIds.has(x.sourceId)&&!!x.evidenceRef),'DIRECTOR_ROUTE_STOP_EVIDENCE','Cite real observed source IDs for every route stop');
 };
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
  check([edit.sourceDuration,edit.playbackSpeed,edit.timelineDuration].every(Number.isFinite),
   'EDL_TREATMENT_FIELDS','Every treated video needs sourceDuration, playbackSpeed and timelineDuration for '+edit.shot_id);
  check(Number.isFinite(speed)&&speed>=.1&&speed<=4,'EDL_PLAYBACK_SPEED','Choose a finite 0.1–4× video playbackSpeed for '+edit.shot_id);
  if(edit.sourceDuration!=null)check(Math.abs(edit.sourceDuration-sourceDuration)<=.02,'EDL_SOURCE_DURATION','sourceDuration must equal source out minus in for '+edit.shot_id);
  if(screenTime!=null)check(Math.abs(screenTime-sourceDuration/speed)<=.08,'EDL_TIMELINE_DURATION','timelineDuration must equal sourceDuration/playbackSpeed for '+edit.shot_id);
 }
 if(edit.timelineDuration!=null&&edit.target_duration_seconds!=null)
  check(Math.abs(edit.timelineDuration-edit.target_duration_seconds)<=.08,'EDL_TARGET_DURATION','Target and presentation duration must agree for '+edit.shot_id);
 }}
 // Editor owns complete Markcut video.md and actual viewer evidence.
 const input=json('episode-input.json');json('music-plan.json');required('video.md');
 const viewer=json('editor-viewer.json');
 if(valid['video.md']){
  check(viewer?.status==='PASS'&&viewer.videoSha256===fingerprint('video.md'),
   'EDITOR_VIEWER_REVISION','Inspect current Markcut player with image/audio and record the exact video.md fingerprint');
  const checkpoints=['opening','middle','ending','transitions','subtitles','audio'];
  check(checkpoints.every(x=>viewer?.checks?.includes(x)),
   'EDITOR_VIEWER_CHECKPOINTS','Actually play/seek/check opening, middle, ending, transitions, captions, audio');
  markcutVerify('video.md');
 }
 if(existsSync(resolve(run,'route.md'))){required('route.md');markcutVerify('route.md');}
 const route=json('route-intent.json');
 if(route?.decision==='include'){
   check(input?.geo?.required!==false&&typeof input?.geo?.insertAfterSceneId==='string',
    'EDITOR_ROUTE_INTEGRATION','Merge Director route plan into episode-input.geo and Markcut timeline');
   check(viewer?.checks?.includes('route'),'EDITOR_ROUTE_VIEWER','View route camera, sound and transitions');
 }else if(route?.decision==='omit'){
   check(!input?.geo||input.geo.required===false,
    'EDITOR_ROUTE_OMISSION','Do not create a route when Director explicitly omitted it');
 }
 if(input?.music?.path)check(confinedFile(input.music.path),'EDITOR_MUSIC_ASSET','Prepare the actual selected BGM before completing Editor');
 for(const scene of input?.scenes||[])if(scene.audioPath)check(confinedFile(scene.audioPath),'EDITOR_VOICEOVER_ASSET','Prepare real audio '+scene.audioPath);
 }else if(stage==='producer'){
 required('video.md');required('editor-viewer.json');
 const receipt=json('production-receipt.json');
 const mp4=required('output/video.mp4');
 if(valid['video.md'])markcutVerify('video.md');
 if(mp4){
   check(receipt?.status==='RENDERED'&&receipt?.videoSha256===fingerprint('output/video.mp4')&&
     receipt?.videoMdSha256===fingerprint('video.md'),
     'PRODUCER_RENDER_IDENTITY','Render and probe exact verified Editor revision; preserve fingerprints');
   const probe=spawnSync('ffprobe',['-v','error','-show_entries','stream=codec_type','-show_entries','format=duration','-of','json',mp4],{encoding:'utf8',timeout:30000});
   let meta;try{meta=JSON.parse(probe.stdout)}catch{}
   check(probe.status===0&&Number(meta?.format?.duration)>0&&
     meta?.streams?.some(x=>x.codec_type==='video')&&meta?.streams?.some(x=>x.codec_type==='audio'),
     'PRODUCER_DECODABLE_MP4','Require real decodable video AND audio streams');
 }
}else if(stage==='publisher'){
 const requestPath=resolve(run,'publisher-request.json');
 if(!noReview && existsSync(requestPath)){
   const request=json('publisher-request.json');const receipt=json('production-receipt.json');required('output/video.mp4');
   check(receipt?.status==='RENDERED'&&receipt.videoSha256===request?.videoSha256,
     'PUBLISHER_VIDEO_IDENTITY','Publication request must authorize exact rendered Producer MP4');
   if(Array.isArray(request?.targets)){
     for(const target of request.targets){
       const name=target?.platform;
       check(['wechat-channels','xhs'].includes(name)&&['draft','publish'].includes(target.action)&&target.authorized===true,
         'PUBLISHER_AUTHORIZATION','Target must be permitted platform and explicitly authorized action');
       if(!['wechat-channels','xhs'].includes(name))continue;
       const p=json('publish/'+name+'-receipt.json');
       check(p?.videoSha256===request.videoSha256&&p?.account===target.account&&p?.action===target.action,
         'PUBLISHER_RECEIPT_IDENTITY','Verify independent platform receipt bound to video/account/action');
       check(target.action==='draft'?p?.status==='draft':
         ['published','reviewing'].includes(p?.status)&&p?.verified===true&&!!p?.identifier,
         'PUBLISHER_PLATFORM_STATUS','Do not claim success from a click, draft, uncertain upload or missing stable ID');
     }
   }else check(false,'PUBLISHER_TARGETS','Provide explicit per-platform targets');
 }
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
