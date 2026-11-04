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
 const evidence=json('vision-evidence.json');const shots=json('shot-selection.json');required('story.md');required('visual-brief.md');required('post.md');
 check(Array.isArray(evidence?.summary),'VISIONER_HANDOFF_MISSING','Use the completed Visioner artifact without re-extraction');
 schema('shot-selection.json','shot-selection.schema.json');
 if(shots?.shots&&evidence){const ids=new Set((evidence.sources||evidence.summary||[]).map(s=>s.source_id));for(const shot of shots.shots)check(ids.has(shot.source_id),'SHOT_SOURCE_REF','Repair selected source_id '+shot.source_id+' against Visioner source IDs');}
}else if(stage==='editor'){
 const shots=json('shot-selection.json');const edl=json('edit-decision-list.json');schema('edit-decision-list.json','edit-decision-list.schema.json');
 if(shots&&edl){const byId=new Map((shots.shots||[]).map(s=>[s.id,s]));for(const edit of edl.edits||[]){
 const shot=byId.get(edit.shot_id);check(!!shot,'EDL_SHOT_REF','Repair shot_id '+edit.shot_id+' to reference Director output');
 if(shot)check(shot.source_id===edit.source_id,'EDL_SOURCE_REF','Use Director source_id for shot '+edit.shot_id);
 check(edit.out_seconds>edit.in_seconds,'EDL_TIMECODE','Set a positive source interval for '+edit.shot_id);
 }}
}else if(stage==='producer'){
 const edl=json('edit-decision-list.json');const input=json('episode-input.json');json('music-plan.json');required('video.md');
 check(Array.isArray(edl?.edits)&&edl.edits.length>0,'PRODUCER_EDITOR_INPUT','Use validated Editor EDL');
 check(Array.isArray(input?.scenes)&&input.scenes.length>0,'EPISODE_SCENES','Compile real scenes from accepted EDL');
 const music=input?.music?.path;
 check(confinedFile(music),'PRODUCER_MUSIC','Build a continuous track from template-declared shared assets; do not require BGM in the initial source run');
 for(const scene of input?.scenes??[])if(scene.audioPath)check(confinedFile(scene.audioPath),'PRODUCER_VOICEOVER','Render the missing stage-local voiceover '+scene.audioPath);
 const draft=valid['video.md'];if(draft){const result=spawnSync('markcut',['verify',draft],{cwd:run,encoding:'utf8',timeout:120000});if(result.status!==0)errors.push({code:'MARKCUT_VERIFY',heal:(result.stderr||result.stdout||result.error?.message||'Fix executable Markcut DSL').slice(0,1600)});}
 // Revisions/feedback are still bound to real human interaction and review receipts; do not fabricate them here.
 check(renderedVideo(),'PRODUCER_RENDER','Render a decodable MP4/MOV into output/ before completing');
 required('reviews/review.json');
}else if(stage==='final-qa'){
 required('qa.md');required('archive-receipt.json');
 check(renderedVideo(),'FINAL_QA_VIDEO','Inspect actual Producer video and report missing output as FAIL');
}else{
 const name=stage==='market'?'reviews/market.md':'reviews/video-director.md';const report=required(name);
 if(report){const value=readFileSync(report,'utf8');check(/\b(PASS|CHANGE_REQUIRED|BLOCKED)\b/.test(value),'REVIEW_VERDICT','Report an explicit video-based verdict');check(/revision/i.test(value),'REVIEW_REVISION','Identify the actual video revision in the review report');}
}
const result={schemaVersion:1,stage,status:errors.length?'FAIL':'PASS',checked:Object.keys(valid),errors};console.log(JSON.stringify(result,null,2));if(errors.length)process.exitCode=1;
