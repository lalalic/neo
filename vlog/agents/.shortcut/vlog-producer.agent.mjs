import { mkdir, writeFile, stat, readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { scope, file, digest, command, sha256 } from './_vlog-contract.mjs';

/** Markcut resolveAll may insert a deterministic seed into the Markdown
 * before rendering. It must not silently change any other Editor content. */
export function assertMarkcutAutoSeedOnly(before,after){
 if(after===before)return false;
 if(!before.startsWith('# video\n')||/^seed:/m.test(before))
   throw Error('Markcut render unexpectedly modified already seeded or invalid Editor Markdown');
 const start=after.split('\n');
 const inserted=start[1];
 if(!/^seed:(?:0|[1-9][0-9]{0,9})$/.test(inserted)||Number(inserted.slice(5))>4294967295)
   throw Error('Markcut render changed Editor Markdown beyond the supported auto-seed insertion');
 const rest=[start[0],...start.slice(2)].join('\n');
 if(rest!==before)throw Error('Markcut render changed Editor Markdown beyond the supported auto-seed insertion');
 return true;
}

export async function run(context) {
 const {input,project,run}=await scope(context);
 const md=await file(run,'video.md');
 const originalEditorMarkdown=await readFile(md,'utf8');
 // Editor no longer requires a native player or viewer receipt; verify the
 // exact current Markdown revision before performing any render side effects.
 await command(context,['markcut','verify',md],run);
 const output=join(run,'output','video.mp4');
 const receiptPath=join(run,'production-receipt.json');
 await mkdir(join(run,'output'),{recursive:true});
 let previouslyRendered=false,previousReceipt=null;
 try{
  await stat(output);
  previouslyRendered=true;
 }catch(error){
  if(error.code!=='ENOENT')throw error;
 }
 if(previouslyRendered){
  try{previousReceipt=JSON.parse(await readFile(receiptPath,'utf8'))}
  catch{throw Error('existing render has no valid receipt; refuse overwrite or guessed recovery')}
  if(previousReceipt?.status!=='RENDERED'||previousReceipt?.videoPath!=='output/video.mp4'
     ||!/^([a-f0-9]{64})$/.test(previousReceipt?.videoSha256??''))
    throw Error('existing render has invalid identity, refuse overwrite');
 } else {
  try{await stat(receiptPath);throw Error('receipt exists without rendered media; refuse inconsistent recovery')}
  catch(error){if(error.code!=='ENOENT')throw error;}
  await command(context,['markcut','render',md,'--output',output],run);
 }
 const currentMarkdown=await readFile(md,'utf8');
 const sourceChanged=previouslyRendered?false:assertMarkcutAutoSeedOnly(originalEditorMarkdown,currentMarkdown);
 if(sourceChanged)await command(context,['markcut','verify',md],run);
 const renderedMdSha=await digest(md);
 const mp4=await file(run,'output/video.mp4');
 const probe=await command(context,['ffprobe','-v','error','-show_entries','stream=codec_type','-show_entries','format=duration','-of','json',mp4],run);
 let info;try{info=JSON.parse(probe.stdout)}catch{throw Error('invalid ffprobe result')}
 if(!Number.isFinite(Number(info?.format?.duration))||Number(info.format.duration)<=0
    ||!info.streams?.some(s=>s.codec_type==='video')
    ||!info.streams?.some(s=>s.codec_type==='audio'))throw Error('rendered MP4 missing playable audio/video streams');
 const hash=await digest(mp4);
 let receipt;
 if(previouslyRendered){
  if(previousReceipt.videoSha256!==hash||Math.abs(Number(previousReceipt.durationSeconds)-Number(info.format.duration))>0.15)
    throw Error('existing rendered video bytes/duration differ from original receipt');
  if(previousReceipt.videoMdSha256===renderedMdSha){
   receipt=previousReceipt;
  }else{
   // Recovery is permitted only for Markcut's documented seed insertion.
   // Require the old receipt SHA to bind the exact unmodified Editor source.
   const baseline=currentMarkdown.replace(/^(# video\n)seed:(?:0|[1-9][0-9]{0,9})\n/,'$1');
   assertMarkcutAutoSeedOnly(baseline,currentMarkdown);
   if(sha256(baseline)!==previousReceipt.videoMdSha256)
    throw Error('existing render identity cannot be rebound to modified Editor Markdown');
   receipt={...previousReceipt,videoMdSha256:renderedMdSha};
   const temp=receiptPath+'.rebinding-'+process.pid;
   await writeFile(temp,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
   await rename(temp,receiptPath);
  }
 }else{
  receipt={schemaVersion:1,status:'RENDERED',videoMdSha256:renderedMdSha,
    videoSha256:hash,videoPath:'output/video.mp4',durationSeconds:Number(info.format.duration),
    verifiedAt:new Date().toISOString()};
  await writeFile(receiptPath,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
 }

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
     previewReceipt={...previewReceipt,videoMdSha256:renderedMdSha,humanDecision:'PENDING'};
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
