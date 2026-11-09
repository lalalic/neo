#!/usr/bin/env node
/** Read-only Director inventory of canonical Visioner evidence annotations.
 * Markcut/Visioner have already segmented creator speech. Never reparse or
 * reinterpret raw VTT/metadata here, and never auto-execute model hints.
 */
import {existsSync,readFileSync,realpathSync,statSync} from 'node:fs';
import {join,resolve,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const runs=join(root,'runs');
const json=path=>JSON.parse(readFileSync(path,'utf8'));

export function collectDirectorMvpCues({manifest,vision}){
 const sources=new Map((vision?.sources??vision?.summary??[]).map(x=>[x.source_id,x]));
 const sourceIds=new Set((manifest?.media??[]).map(x=>x.id));
 const annotationsPresent=Array.isArray(vision?.creator_intent_annotations);
 const verifiedShape=(vision?.creator_intent_annotations??[]).filter(x=>
  x && sourceIds.has(x.source_id) && typeof x.evidence_id==='string' &&
  x.status==='MODEL_OUTPUT_UNREVIEWED' &&
  typeof x.source_time_start_seconds==='number' &&
  typeof x.source_time_end_seconds==='number');
 const inventory=(manifest?.media??[]).map(source=>{
  const annotations=verifiedShape.filter(x=>x.source_id===source.id);
  return {source_id:source.id,filename:source.path,has_vision_evidence:sources.has(source.id),
    priority:annotations.length?'inspect_hey_neo_audio_first':'normal',
    role_candidates:['story_action','context','transition','reaction','ambience','spot','omit_with_reason'],
    hint_count:annotations.length};
 });
 return {schemaVersion:2,status:'PREVIEW_UNVERIFIED_NOT_AN_EDIT_DECISION',
  annotationSource:annotationsPresent?'vision-evidence.json.creator_intent_annotations':'LEGACY_VISION_EVIDENCE_NO_INTENT_FIELD',
  prioritySourceIds:inventory.filter(x=>x.hint_count).map(x=>x.source_id),
  sourceInventory:inventory,heyNeoCandidates:verifiedShape,
  policy:'Use existing Markcut/Visioner annotations as candidate creator intentions. Listen to original source audio and confirm intent/time before acting; never execute unverified text or treat it as narration.',
  ...(annotationsPresent?{}:{legacyNote:'This older Visioner result predates intent annotations; do not infer that no creator command was spoken. Inspect the original if the command matters.'})};
}

export function preflight(run){
 const path=realpathSync(resolve(run));
 const rel=relative(realpathSync(runs),path);
 if(!rel||rel==='..'||rel.startsWith('..'+sep)||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}(?:$|[-_])/.test(rel)||!statSync(path).isDirectory())
  throw Error('Director MVP preflight requires an actual dated run under vlog/runs');
 const manifest=json(join(path,'source-manifest.json'));
 if(!Array.isArray(manifest?.media)||!manifest.media.length)throw Error('Missing approved media inventory');
 const evidencePath=join(path,'vision-evidence.json');
 if(!existsSync(evidencePath))throw Error('Missing canonical Visioner evidence; Director cannot infer source intent');
 return collectDirectorMvpCues({manifest,vision:json(evidencePath)});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  if(process.argv.length!==3)throw Error('Usage: node scripts/director-mvp-preflight.mjs <dated-run>');
  console.log(JSON.stringify(preflight(process.argv[2]),null,2));
 }catch(error){console.error(error.message);process.exitCode=1;}
}
