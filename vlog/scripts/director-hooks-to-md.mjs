#!/usr/bin/env node
/** Director's optional Hook choices → deterministic Markcut Review; no new story contract. */
import {join} from 'node:path';
import {runDir,json,sourceIndex,previewAsset,saveMd,clamp} from '../lib/review-markcut.mjs';

export async function build(runPath){
 const run=await runDir(runPath),sources=await sourceIndex(run);
 const hooks=await json(join(run,'director-hooks.json'));
 if(!Array.isArray(hooks.hooks)||hooks.hooks.length<2||hooks.hooks.length>3)
  throw Error('Interactive Director must supply 2–3 genuine alternate Hooks');
 if(typeof hooks.recommended_hook_id!=='string'||!hooks.hooks.some(h=>h.id===hooks.recommended_hook_id))
  throw Error('Exactly one existing recommended_hook_id is required');
 const ids=new Set(),scenes=[];
 for(const hook of hooks.hooks){
  if(!/^[a-z][a-z0-9-]{0,40}$/.test(hook.id??'')||ids.has(hook.id))throw Error('Invalid/duplicate Hook ID');
  ids.add(hook.id);
  if(!clamp(hook.title,110)||!clamp(hook.guide,800))throw Error('Hook requires title and creative guide');
  if(!Array.isArray(hook.media)||hook.media.length<1||hook.media.length>3)throw Error('Hook requires 1–3 original source cuts');
  const media=[];
  for(let i=0;i<hook.media.length;i++){
   const cut=hook.media[i];
   const src=sources.get(cut.source_id);
   if(!src)throw Error('Hook references unknown source: '+cut.source_id);
   if(src.media_type==='video'&&(!Number.isFinite(cut.start_seconds)||!Number.isFinite(cut.end_seconds)))
    throw Error('Video Hook must specify precise source original timecodes');
   const asset=await previewAsset(run,src,{stage:'director',key:hook.id+'-'+i,
    start:cut.start_seconds,end:cut.end_seconds,stillSeconds:cut.duration_seconds??2.5});
   media.push(asset);
  }
  const recommended=hook.id===hooks.recommended_hook_id;
  const guide=clamp(hook.guide,450);
  const context=clamp(hook.reason,260);
  const mediaRefs=hook.media.map(x=>x.source_id+':'+(x.start_seconds??'still')+'–'+(x.end_seconds??'still')).join(', ');
  const mediaHashes=[...new Set(hook.media.map(x=>x.source_id))].map(id=>id+':'+sources.get(id).sha256).join(', ');
  scenes.push({id:hook.id,title:hook.title,recommended,
   guide:`${guide}${context?'\n理由：'+context:''}\n素材：${mediaRefs}`,
   instruction:`Hook ID: ${hook.id}; 推荐: ${recommended}; Guide: ${clamp(hook.guide,2200)}; 理由: ${context}; Original sources: ${mediaRefs}; SHA-256 identity: ${mediaHashes}. User may choose this Scene and comment to request changes.`,
   media});
 }
 const output=join(run,'director-hooks.md');
 await saveMd(output,scenes,{title:'Director · 选择故事方向',metadata:'Each Scene is a proposed Hook; approved means choose recommended if no explicit other choice'});
 return {stage:'director',preview:output,recommended_hook_id:hooks.recommended_hook_id,hooks:scenes.map(s=>s.id),review:'NOT_REQUESTED'};
}
if(process.argv[1]&&process.argv[1].endsWith('director-hooks-to-md.mjs')){
 build(process.argv[2]).then(v=>console.log(JSON.stringify(v,null,2))).catch(e=>{console.error(e.message);process.exitCode=1;});
}
