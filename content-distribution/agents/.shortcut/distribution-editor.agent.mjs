import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {scope,jsonRun,readRun,sourceCheck,runSchema,command,completed} from './contract.mjs';

export async function run(context) {
  const {run,project}=await scope(context);
  const original=await sourceCheck(context,project,run);
  const strategy=await jsonRun(run,'market-strategy.json');
  const plan=await jsonRun(run,'creative-plan.json');
  if((await runSchema(context,project,plan.path,'creative-plan.schema.json')).valid!==true)
    throw Error('creative_plan_schema_invalid');
  if(plan.data.campaign_id!==strategy.data.campaign_id ||
    new Set(plan.data.creatives.map(v=>v.id)).size!==plan.data.creatives.length ||
    plan.data.creatives.length!==strategy.data.variants.length) throw Error('editor_variants_not_matching_strategy');
  const selected=new Map(strategy.data.variants.map(v=>[v.id,v]));
  const files=[plan.path];
  for(const creative of plan.data.creatives) {
    if(!selected.has(creative.id) || creative.status!=='qa_passed' ||
      creative.source_evidence.some(s=>s.start_s<0||s.end_s>original.duration_s+0.05||s.end_s<=s.start_s))
      throw Error('creative_unverified_or_wrong_source');
    if(!/^creatives\/[a-z0-9-]+\/video\.md$/.test(creative.video_path))
      throw Error('creative_video_path_outside_run');
    const video=await readRun(run,creative.video_path);
    const folder=creative.video_path.slice(0,-'video.md'.length);
    const qa=await jsonRun(run,`${folder}qa.json`);
    // Verify the local Markcut media mirror is the exact validated original.
    const sceneMedia=await readRun(run,`${folder}media/episode.mp4`);
    if(createHash('sha256').update(await readFile(sceneMedia.path)).digest('hex')!==original.source_sha256)
      throw Error('creative_media_different_from_original');
    const movie=await readRun(run,`${folder}preview.mp4`);
    const movieSha=createHash('sha256').update(await readFile(movie.path)).digest('hex');
    if(qa.data.source_sha256!==original.source_sha256 || qa.data.render_sha256!==movieSha ||
      qa.data.render_path!==movie.path || qa.data.verified!==true)
      throw Error('editor_movie_qa_not_bound_to_original');
    await command(context,project,['markcut','verify',video.path]);
    const probe=await command(context,project,['ffprobe','-v','error','-show_streams','-of','json',movie.path],{json:true});
    if(!probe.streams?.some(stream=>stream.codec_type==='video') ||
      !probe.streams?.some(stream=>stream.codec_type==='audio'))
      throw Error('editor_render_missing_video_or_audio');
    await command(context,project,['ffmpeg','-v','error','-i',movie.path,'-f','null','-']);
    files.push(video.path,qa.path,movie.path,sceneMedia.path);
  }
  return completed({creative_plan_path:plan.path,verified_creatives:plan.data.creatives.length,
    source_sha256:original.source_sha256,publicationAllowed:false},files);
}
export default {run};
