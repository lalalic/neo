import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,statSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {preparePlaybackMedia} from '../lib/media-treatment.mjs';
import {compileCinematicVlog} from '../lib/cinematic-vlog.mjs';
const cmd=(bin,...args)=>execFileSync(bin,args,{encoding:'utf8'});
const duration=file=>Number(cmd('ffprobe','-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',file).trim());
const scene={id:'creek-motion',type:'video',path:'input/creek.mp4',sourceEvidencePath:'input/creek.mp4',sourceHash:'original-source-hash',evidenceRef:'vision evidence original creek',duration:3.1,sourceInSeconds:0,sourceOutSeconds:1.55,sourceDuration:1.55,playbackSpeed:0.5,timelineDuration:3.1,volume:0};
function fixture(){const dir=mkdtempSync(join(tmpdir(),'vlog-story-media-'));mkdirSync(join(dir,'input'));const src=join(dir,scene.path);
 cmd('ffmpeg','-y','-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc=size=160x284:rate=30:duration=1.5667','-c:v','libx264','-pix_fmt','yuv420p',src);
 return {dir,src,clean:()=>rmSync(dir,{force:true,recursive:true})};}
test('story screen time may exceed source duration using real derived half-speed video',async()=>{
 const f=fixture();try{
  const before=statSync(f.src).size,output=await preparePlaybackMedia({fps:30,scenes:[scene]},{runDir:f.dir}),treated=output.scenes[0];
  assert.equal(output.scenes.length,1);assert.equal(treated.mediaTreatment.sourceDuration,1.55);
  assert.equal(treated.mediaTreatment.timelineDuration,3.1);assert.equal(treated.mediaTreatment.playbackSpeed,.5);
  assert.equal(treated.sourceHash,scene.sourceHash);assert.equal(treated.sourceEvidencePath,scene.path);
  assert.match(treated.path,/^assets\/treated-media\/00-[a-f0-9]{12}\.mp4$/);
  assert.notEqual(treated.path,scene.path);assert.equal(statSync(f.src).size,before,'original modified');
  assert.ok(Math.abs(duration(join(f.dir,treated.path))-3.1)<.09,'the derived video did not actually slow down');
  assert.equal((await preparePlaybackMedia({fps:30,scenes:[scene]},{runDir:f.dir})).scenes[0].path,treated.path,'repeat compile did not reuse deterministic derivative');
 }finally{f.clean();}
});
test('story retiming fails closed for unmuted slowed speech, invalid provenance and mismatched timeline',async()=>{
 const f=fixture();try{
  const prepare=s=>preparePlaybackMedia({fps:30,scenes:[{...scene,...s}]},{runDir:f.dir});
  await assert.rejects(prepare({volume:0.7}),/MEDIA_SLOW_AUDIO_UNSUPPORTED/);
  await assert.rejects(prepare({timelineDuration:1.55}),/MEDIA_TIMELINE_MISMATCH/);
  await assert.rejects(prepare({sourceOutSeconds:2}),/MEDIA_TREATMENT_INVALID_RANGE_OR_SPEED/);
  await assert.rejects(prepare({playbackSpeed:0}),/MEDIA_TREATMENT_INVALID_RANGE_OR_SPEED/);
  await assert.rejects(prepare({path:'../secret.mp4'}),/MEDIA_OUTSIDE_RUN|MEDIA_SOURCE_MUST_BE_ORIGINAL/);
 }finally{f.clean();}
});
test('derived-video treatment rejects original source symlink escaping the canonical run',async()=>{
 const f=fixture();const alternate=mkdtempSync(join(tmpdir(),'vlog-remote-'));try{
  const external=join(alternate,'external.mp4');cmd('ffmpeg','-y','-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=red:s=160x284:d=2','-c:v','libx264',external);
  symlinkSync(external,join(f.dir,'input','escape.mp4'));
  const escaping={...scene,path:'input/escape.mp4',sourceEvidencePath:'input/escape.mp4'};
  await assert.rejects(preparePlaybackMedia({fps:30,scenes:[escaping]},{runDir:f.dir}),/MEDIA_SOURCE_SYMLINK_ESCAPE/);
 }finally{f.clean();rmSync(alternate,{recursive:true,force:true});}
});
test('filmable still-motion variants are emitted as actual custom Markcut effects',()=>{
 const f=fixture();const cwd=process.cwd();try{
  process.chdir(f.dir);
  cmd('ffmpeg','-y','-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=blue:s=160x284','-frames:v','1','input/still.png');
  cmd('ffmpeg','-y','-hide_banner','-loglevel','error','-f','lavfi','-i','sine=frequency=220:duration=6','-c:a','aac','input/music.m4a');
  const scenes=[{id:'opening',type:'image',beat:'hook',path:'input/still.png',duration:3,sourceHash:'original-1',evidenceRef:'scene1',override:{motion:'driftLeft',description:'a visual direction across the same verified source photo',rationale:'introduce the story on its real evidence',evidenceRef:'source'}} ,{id:'end',type:'image',beat:'payoff',path:'input/still.png',duration:3,sourceHash:'original-1',evidenceRef:'scene1',override:{motion:'zoomOut',description:'return to the source for a payoff',rationale:'clear visual callback',evidenceRef:'source'}}];
  const m={scenes,boundaries:[{transition:'fade',seconds:0.2,rationale:'story beat turns'}],music:{path:'input/music.m4a',catalogReference:'Artlist:133995+133996',evidenceRef:'synthetic selected-track media test'}};
  const md=compileCinematicVlog(m);
  assert.match(md,/scale\(1\.12\) translateX\(2%\)/);
  assert.match(md,/scale\(1\.12\) translateX\(-2%\)/);
  assert.match(md,/scale\(1\.02\)/);
  assert.match(md,/scale\(1\.12\)/);
 }finally{process.chdir(cwd);f.clean();}
});
