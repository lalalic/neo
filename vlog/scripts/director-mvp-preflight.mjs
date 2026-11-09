#!/usr/bin/env node
/** Read-only Director source inventory, especially unverified "嘿 Neo" cues.
 * Never converts STT/segment hints into verified speech or executes commands.
 */
import {existsSync,readFileSync,realpathSync,statSync} from 'node:fs';
import {join,basename,resolve,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const runs=join(root,'runs');
const wake=/\b(?:hey|hei|hi)\s*[,，!！-]?\s*neo\b|[嘿嗨]\s*neo\b/iu;
const trim=(text,n=240)=>String(text??'').trim().replace(/\s+/g,' ').slice(0,n);
const json=(path,defaultValue=null)=>existsSync(path)?JSON.parse(readFileSync(path,'utf8')):defaultValue;
export const hasHeyNeo=text=>wake.test(String(text??''));

export function collectDirectorMvpCues({manifest,vision,metadata={},vttBySource={}}){
 const observed=new Set((vision?.sources??vision?.summary??[]).map(x=>x.source_id));
 const inventory=[],signals=[];
 for(const source of manifest?.media??[]){
  const id=source.id;
  const media=metadata?.[id]?.perception??{};
  const found=[];
  for(const [range,segment] of Object.entries(media.segments??{})){
   for(const hint of Array.isArray(segment?.instructions)?segment.instructions:[]){
    if(!hasHeyNeo(hint?.utterance))continue;
    found.push({origin:'markcut_segment_instruction_unverified',source_id:id,
     range,utterance:trim(hint.utterance),intent_hint:trim(hint.intent),
     time_seconds:Number.isFinite(hint.time_seconds)?hint.time_seconds:null,
     confidence_hint:trim(hint.confidence)});
   }
  }
  const vtt=vttBySource[id]??'';
  const blocks=vtt.split(/\r?\n\s*\r?\n/);
  for(const block of blocks){
   if(!hasHeyNeo(block))continue;
   const lines=block.split(/\r?\n/);
   const timing=lines.find(x=>x.includes('-->'))??'';
   const speech=lines.filter(x=>!x.includes('-->')&&!/^WEBVTT\s*$/i.test(x)&&!/^[0-9]+$/.test(x.trim())).join(' ');
   if(!hasHeyNeo(speech))continue;
   found.push({origin:'source_vtt_unverified',source_id:id,
    range:trim(timing,120),utterance:trim(speech),intent_hint:null,time_seconds:null,confidence_hint:'unverified'});
  }
  inventory.push({source_id:id,filename:source.path,has_vision_evidence:observed.has(id),
   priority:found.length?'inspect_hey_neo_audio_first':'normal',
   role_candidates:['story_action','context','transition','reaction','ambience','spot','omit_with_reason'],
   hint_count:found.length});
  signals.push(...found);
 }
 return {schemaVersion:1,status:'PREVIEW_UNVERIFIED_NOT_AN_EDIT_DECISION',
  prioritySourceIds:inventory.filter(x=>x.hint_count).map(x=>x.source_id),
  sourceInventory:inventory,heyNeoCandidates:signals,
  policy:'Listen to actual source sound and confirm intent and source time before honoring an owner command; not narration, not automatic cut, and never delete footage merely from STT.'};
}

export function preflight(run){
 const path=realpathSync(resolve(run));
 const rel=relative(realpathSync(runs),path);
 if(!rel||rel==='..'||rel.startsWith('..'+sep)||!/^\d{4}-\d{2}-\d{2}(?:$|[-_])/.test(rel)||!statSync(path).isDirectory())
  throw Error('Director MVP preflight requires an actual dated run under vlog/runs');
 const manifest=json(join(path,'source-manifest.json'));
 if(!Array.isArray(manifest?.media)||!manifest.media.length)throw Error('Missing approved media inventory');
 const vision=json(join(path,'vision-evidence.json'),{});
 const meta=json(join(path,'input','media','metadata.json'),json(join(path,'metadata.json'),{}));
 const transcripts={};
 for(const m of manifest.media){
  if(m.id!==basename(m.id)||m.path!==basename(m.path)||!m.path||m.id==='.'||m.id==='..')throw Error('Unsafe media identity');
  if(/^[a-zA-Z0-9._-]+$/.test(m.id)){
   const p=join(path,'input','media',m.id+'.vtt');
   if(existsSync(p)&&statSync(p).isFile()&&statSync(p).size<=1024*1024)transcripts[m.id]=readFileSync(p,'utf8');
  }
 }
 return collectDirectorMvpCues({manifest,vision,metadata:meta,vttBySource:transcripts});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  if(process.argv.length!==3)throw Error('Usage: node scripts/director-mvp-preflight.mjs <dated-run>');
  console.log(JSON.stringify(preflight(process.argv[2]),null,2));
 }catch(error){console.error(error.message);process.exitCode=1;}
}
