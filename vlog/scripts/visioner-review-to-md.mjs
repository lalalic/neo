#!/usr/bin/env node
/** Optional Visioner source-review view; existing vision-evidence.json stays authoritative. */
import {join} from 'node:path';
import {runDir,json,sourceIndex,previewAsset,saveMd,clamp} from '../lib/review-markcut.mjs';

export async function build(runPath){
 const run=await runDir(runPath),sources=await sourceIndex(run);
 const evidence=await json(join(run,'vision-evidence.json'));
 const list=Array.isArray(evidence.sources)?evidence.sources:[];
 const byId=new Map(list.map(s=>[s.source_id,s]));
 if(list.length!==sources.size||new Set(list.map(s=>s.source_id)).size!==sources.size)
  throw Error('Visioner evidence must represent every source exactly once');
 const scenes=[];
 for(const [id,src] of sources){
  const item=byId.get(id);
  if(!item||item.source_sha256!==src.sha256)throw Error('Evidence identity mismatch: '+id);
  const asset=await previewAsset(run,src,{stage:'visioner',key:'source-'+id});
  const range=asset.type==='video'?`片段 ${asset.from}–${asset.to}s（仅为前段预览，非整片）`:'原始照片的缩小预览';
  const prompt='请检查本素材理解是否准确；指出漏掉的人物动作、错误描述、重要原声和具体原始时间点。';
  const summary=clamp(item.summary,180);
  const cues=(Array.isArray(evidence.creator_intent_annotations)?evidence.creator_intent_annotations:[])
   .filter(cue=>cue.source_id===id && cue.source_sha256===src.sha256);
  const cueNote=cues.map(cue=>
   `「嘿 Neo」候选 · 原始 ${cue.source_time_start_seconds}–${cue.source_time_end_seconds}s · `+
   `原话：${clamp(cue.utterance,140)} · 意图：${clamp(cue.intent_hint,110)}（待核听，不自动执行）`).join('\n');
  scenes.push({id:'media-'+id,title:'素材 '+id+' · '+src.media_type,
   guide:`${prompt}\n${range}\nAI: ${summary}${cueNote?'\n'+cueNote:''}`,
   instruction:`source_id=${id}; sha256=${src.sha256}; ${range}; Visioner 原文:${clamp(item.summary,1800)}; ${cueNote}; 此内容未经人工确认。反馈应引用源媒体原始时间，不要臆造。`,
   media:[asset]});
 }
 const output=join(run,'visioner-review.md');
 await saveMd(output,scenes,{title:'Visioner · 逐素材理解审核',metadata:'Source-linked private Visioner review; source timestamps, not edit timeline'});
 return {stage:'visioner',preview:output,scenes:scenes.length,review:'NOT_REQUESTED'};
}
if(process.argv[1]&&process.argv[1].endsWith('visioner-review-to-md.mjs')){
 build(process.argv[2]).then(v=>console.log(JSON.stringify(v,null,2))).catch(e=>{console.error(e.message);process.exitCode=1;});
}
