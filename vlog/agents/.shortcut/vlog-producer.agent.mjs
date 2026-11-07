import { mkdir, writeFile, stat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { scope, file, digest, command } from './_vlog-contract.mjs';
import { rootBackgroundMusic, evaluateMusicAudibility } from '../../lib/bgm-audibility.mjs';

export async function run(context) {
 const {input,project,run}=await scope(context);
 const md=await file(run,'video.md');
 const version=await digest(md);
 // Editor no longer requires a native player or viewer receipt; verify the
 // exact current Markdown revision before performing any render side effects.
 await command(context,['markcut','verify',md],run);
 // A valid Markcut file can still encode nearly silent background music.
 // Measure the actual source at its authored gain before expensive rendering.
 const music=rootBackgroundMusic(await readFile(md,'utf8'));
 let bgmAudibility=null;
 if(music){
   const bgm=await file(run,music.src);
   const measured=await command(context,
     ['ffmpeg','-hide_banner','-nostats','-i',bgm,'-vn','-af','volumedetect','-f','null','-'],run);
   bgmAudibility=evaluateMusicAudibility(music,String(measured.stderr||'')+'\n'+String(measured.stdout||''));
 }
 const output=join(run,'output','video.mp4');
 await mkdir(join(run,'output'),{recursive:true});
 try{await stat(output);throw Error('existing render requires explicit inspection, never overwrite')}catch(e){
  if(e.code!=='ENOENT')throw e;
 }
 await command(context,['markcut','render',md,'--output',output],run);
 const mp4=await file(run,'output/video.mp4');
 const probe=await command(context,['ffprobe','-v','error','-show_entries','stream=codec_type','-show_entries','format=duration','-of','json',mp4],run);
 let info;try{info=JSON.parse(probe.stdout)}catch{throw Error('invalid ffprobe result')}
 if(!Number.isFinite(Number(info?.format?.duration))||Number(info.format.duration)<=0
    ||!info.streams?.some(s=>s.codec_type==='video')
    ||!info.streams?.some(s=>s.codec_type==='audio'))throw Error('rendered MP4 missing playable audio/video streams');
 const hash=await digest(mp4);
 const receipt={schemaVersion:1,status:'RENDERED',videoMdSha256:version,
   videoSha256:hash,videoPath:'output/video.mp4',durationSeconds:Number(info.format.duration),
   verifiedAt:new Date().toISOString(),...(bgmAudibility?{bgmAudibility}:{})};
 await writeFile(join(run,'production-receipt.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
 let previewReceipt=null;
 if(input.preview){
   if(input.preview.mode==='event'){
     const template=await file(run,input.preview.eventTemplatePath);
     const prepared=await command(context,['neo','project','review','checkpoint','--project','vlog','--path',run,'--stage','producer'],run);
     const reviewIdentity=JSON.parse(prepared.stdout);
     if(reviewIdentity.status!=='ready'||!/^[a-f0-9]{40}$/.test(reviewIdentity.commitSha))
       throw Error('Runner did not produce an immutable Review Git Commit SHA');
     const submitted=await command(context,['markcut','preview',md,'--delivery','event','--event-template',template,'--commit-sha',reviewIdentity.commitSha],run);
     try{previewReceipt=JSON.parse(submitted.stdout)}catch{throw Error('missing machine-readable Markcut preview receipt')}
     if(previewReceipt.status!=='review_requested'||!previewReceipt.requestId||!previewReceipt.commitSha||previewReceipt.commitSha!==reviewIdentity.commitSha)
       throw Error('Markcut did not confirm the requested interactive review revision');
     previewReceipt={...previewReceipt,videoMdSha256:version,humanDecision:'PENDING'};
     await writeFile(join(run,'preview-request.json'),JSON.stringify(previewReceipt,null,2)+'\n',{flag:'wx'});
   }else if(input.preview.mode==='native'){
     await command(context,['markcut','preview',md],run);
   }else throw Error('Unsupported preview mode');
 }
 const checked=await command(context,[process.execPath,join(project,'scripts/validate-stage.mjs'),'producer',run],run);
 if(!JSON.parse(checked.stdout).status?.includes('PASS'))throw Error('Producer stage validation did not PASS');
 return {status:'COMPLETED',output:{...receipt,preview:previewReceipt||{status:'NOT_REQUESTED'}},
   artifacts:[mp4,join(run,'production-receipt.json'),...(previewReceipt?[join(run,'preview-request.json')]:[])]};
}
export default {run};
