#!/usr/bin/env node
/** Project-local, render-free review view of the already-produced final MP4. */
import {join} from 'node:path';
import {writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {runDir,json,hashFile,command,quote} from '../lib/review-markcut.mjs';

export function finalFilmMarkdown({title,width,height,duration,videoSha256}){
 if(!Number.isInteger(width)||width<=0||!Number.isInteger(height)||height<=0
   ||!Number.isFinite(duration)||duration<=0||!/^[a-f0-9]{64}$/i.test(videoSha256??''))
  throw Error('Final film Preview needs verified video identity, dimensions and duration');
 const guide='Producer 已渲染的完整成片（包括全部场景、字幕、音乐和原声）。请播放后对整体或时间点评论；修改由 Editor 回到原始 video.md 执行。本 MD 仅用于 Review。';
 const seed=createHash('sha256').update(videoSha256).digest().readUInt32BE(0);
 return [
  '# video',`seed:${seed}`,
  `title:${quote(String(title||'Vlog 成片预览').slice(0,140)+' · 成片审核')} width:${width} height:${height} fps:30 layout:series`,
  '', '## finished-film', 'layout:parallel',`instruction:${quote(guide)}`,
  `- video src:output/video.mp4 duration:${duration.toFixed(3)} volume:1 fit:contain`,''
 ].join('\n');
}

export async function build(runPath){
 const run=await runDir(runPath);
 const receipt=await json(join(run,'production-receipt.json'));
 if(receipt.status!=='RENDERED'||receipt.videoPath!=='output/video.mp4'
  || !/^[a-f0-9]{64}$/i.test(receipt.videoSha256??'')
  || !/^[a-f0-9]{64}$/i.test(receipt.videoMdSha256??''))
   throw Error('Producer receipt is not a verified rendered film');
 const mp4=join(run,'output/video.mp4');
 const md=join(run,'video.md');
 if(await hashFile(mp4)!==receipt.videoSha256 || await hashFile(md)!==receipt.videoMdSha256)
  throw Error('Rendered film or Editor MD changed since Producer receipt');
 const probe=JSON.parse(await command('ffprobe',['-v','error','-show_entries',
  'format=duration:stream=codec_type,width,height','-of','json',mp4]));
 const duration=Number(probe.format?.duration);
 const video=probe.streams?.find(s=>s.codec_type==='video');
 if(!video||!probe.streams?.some(s=>s.codec_type==='audio')||!Number.isFinite(duration)||duration<=0)
  throw Error('Final MP4 requires decodable video/audio and finite duration');
 const story=await json(join(run,'personal-story.json'));
 const reviewMd=join(run,'final-film-preview.md');
 const body=finalFilmMarkdown({title:story.title,width:video.width,height:video.height,
  duration,videoSha256:receipt.videoSha256});
 await writeFile(reviewMd,body);
 await command('markcut',['verify',reviewMd]);
 return {status:'VALID',preview:reviewMd,scenes:1,durationSeconds:duration,
  videoSha256:receipt.videoSha256,sourceMdSha256:receipt.videoMdSha256};
}
if(process.argv[1]?.endsWith('final-film-to-md.mjs')){
 build(process.argv[2]).then(r=>console.log(JSON.stringify(r,null,2)))
  .catch(e=>{console.error(e.message);process.exitCode=1;});
}
