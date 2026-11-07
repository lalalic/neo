/** Adapt source-linked shots to the story timeline without modifying the originals. */
import {mkdir,stat,realpath,rename} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {resolve,relative,join,sep,isAbsolute} from 'node:path';
const exec=promisify(execFile);
const round=n=>Number(n.toFixed(3));
function confined(runDir,file){
 if(typeof file!=='string'||!file)throw Error('MEDIA_SOURCE_REQUIRED');
 const full=resolve(runDir,file),rel=relative(runDir,full);
 if(rel===''||rel==='..'||rel.startsWith('..'+sep))throw Error('MEDIA_OUTSIDE_RUN: '+file);
 return {full,rel:rel.split(sep).join('/')};
}
async function probe(file){
 const {stdout}=await exec('ffprobe',['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',file]);
 const n=Number(stdout.trim());if(!(n>0))throw Error('MEDIA_DURATION_INVALID: '+file);
 return n;
}
/** Only explicitly treated clips are changed; still photos use Markcut camera motion. */
export async function preparePlaybackMedia(input,{runDir=process.cwd()}={}){
 const root=resolve(runDir),canonicalRoot=await realpath(root),scenes=[];
 for(const [index,scene] of (input.scenes||[]).entries()){
  if(scene.type!=='video'){scenes.push(scene);continue;}
  const specified=['sourceInSeconds','sourceOutSeconds','playbackSpeed','sourceDuration','timelineDuration'].some(k=>scene[k]!=null);
  if(!specified){scenes.push(scene);continue;}
  const original=confined(root,scene.sourceEvidencePath||scene.path);
  const inputFile=confined(root,scene.path);
  // Never transcode a previously generated derivative as if it were camera evidence.
  if(original.rel!==inputFile.rel)throw Error('MEDIA_SOURCE_MUST_BE_ORIGINAL: '+scene.id);
  const originalReal=await realpath(original.full),realRel=relative(canonicalRoot,originalReal);
  if(realRel===''||realRel==='..'||realRel.startsWith('..'+sep)||isAbsolute(realRel))throw Error('MEDIA_SOURCE_SYMLINK_ESCAPE: '+scene.id);
  const info=await stat(original.full);if(!info.isFile())throw Error('MEDIA_SOURCE_NOT_FILE: '+scene.id);
  const length=await probe(original.full);
  const start=scene.sourceInSeconds??0,end=scene.sourceOutSeconds??length,speed=scene.playbackSpeed??1;
  if(![start,end,speed].every(Number.isFinite)||start<0||end<=start||end>length+0.05||speed<0.1||speed>4)
   throw Error('MEDIA_TREATMENT_INVALID_RANGE_OR_SPEED: '+scene.id);
  const sourceDuration=end-start,expected=sourceDuration/speed,duration=scene.timelineDuration??scene.duration;
  if(!(duration>0)||Math.abs(duration-expected)>0.08||Math.abs(scene.duration-duration)>0.08)
   throw Error('MEDIA_TIMELINE_MISMATCH: '+scene.id+' sourceDuration/playbackSpeed must equal timelineDuration and duration');
  if(scene.sourceDuration!=null&&Math.abs(scene.sourceDuration-sourceDuration)>0.02)
   throw Error('MEDIA_SOURCE_DURATION_MISMATCH: '+scene.id);
  const volume=scene.override?.sourceAudioVolume??scene.volume??0.72;
  if(speed!==1&&volume>0)throw Error('MEDIA_SLOW_AUDIO_UNSUPPORTED: mute slowed source audio and use separately verified ambience');
  const fps=input.fps??30;
  if(!Number.isInteger(fps)||fps<1||fps>120)throw Error('MEDIA_FPS_INVALID');
  const fingerprint=createHash('sha256').update(JSON.stringify([original.rel,info.size,info.mtimeMs,start,end,speed,duration,fps])).digest('hex').slice(0,12);
  const rel=join('assets','treated-media',`${String(index).padStart(2,'0')}-${fingerprint}.mp4`);
  const target=confined(root,rel);
  const folder=resolve(root,'assets','treated-media');
  await mkdir(folder,{recursive:true});
  const actualFolder=await realpath(folder),folderRel=relative(canonicalRoot,actualFolder);
  if(folderRel==='..'||folderRel.startsWith('..'+sep)||isAbsolute(folderRel))throw Error('MEDIA_OUTPUT_SYMLINK_ESCAPE: '+scene.id);
  let existing=false;
  try{existing=(await stat(target.full)).size>0&&Math.abs((await probe(target.full))-duration)<=1/fps+0.06;}catch{}
  if(!existing){
   const filters=`setpts=(PTS-STARTPTS)/${speed},fps=${fps},format=yuv420p`;
   const temp=target.full.replace(/\.mp4$/,`.pending-${process.pid}.mp4`);
   const args=['-y','-hide_banner','-loglevel','error','-ss',String(start),'-t',String(sourceDuration),'-i',original.full,'-vf',filters,'-t',String(duration),'-map','0:v:0'];
   if(speed===1)args.push('-map','0:a?','-c:a','aac');else args.push('-an');
   args.push('-c:v','libx264','-preset','veryfast','-crf','19','-pix_fmt','yuv420p','-movflags','+faststart',temp);
   await exec('ffmpeg',args,{maxBuffer:4*1024*1024,timeout:120000});
   if(Math.abs((await probe(temp))-duration)>1/fps+0.06||(await stat(temp)).size<1000)throw Error('MEDIA_RENDER_DURATION_MISMATCH: '+scene.id);
   await rename(temp,target.full);
  }
  scenes.push({...scene,path:target.rel,sourceEvidencePath:original.rel,duration:round(duration),mediaTreatment:{sourcePath:original.rel,sourceInSeconds:start,sourceOutSeconds:end,sourceDuration:round(sourceDuration),playbackSpeed:speed,timelineDuration:round(duration),type:'derived-editorial-playback'}});
 }
 return {...input,scenes};
}
