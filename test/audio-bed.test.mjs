import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {makeEnvelope,validatePlan,buildCommand,render} from '../scripts/audio-bed.mjs';
const fixture=()=>{
 const dir=mkdtempSync(join(tmpdir(),'neo-audio-bed-'));
 const music=join(dir,'bed.wav'),fx=join(dir,'fx.wav');
 for(const [name,tone] of [[music,330],[fx,640]]){
  const p=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','lavfi','-i',`sine=frequency=${tone}:duration=1`,'-ar','48000',name],{encoding:'utf8'});
  assert.equal(p.status,0,p.stderr);
 }
 const plan={durationSeconds:2.4,music:{path:music,gain:0.7},duck:{gain:0.2,fadeSeconds:0.12,windows:[{startSeconds:0.55,endSeconds:1.05},{startSeconds:0.96,endSeconds:1.47}]},effects:[{path:fx,atSeconds:1.55,gain:0.3}],output:join(dir,'prepared.m4a')};
 return {dir,plan,cleanup:()=>rmSync(dir,{recursive:true,force:true})};
};
test('Audio bed plan validates real local media, merges overlapping duck ranges, denies overwrite',()=>{
 const f=fixture();try{
  const p=validatePlan(f.plan);
  assert.equal(p.windows.length,1);
  assert.equal(p.windows[0].start,0.55);
  assert.equal(p.windows[0].end,1.47);
  assert.equal(p.effects.length,1);
  assert.match(makeEnvelope(p.windows,p.duckGain,p.fade),/if\(between/);
  const cmd=buildCommand(p,f.plan.output+'.tmp');
  assert.equal(cmd[0],'ffmpeg');
  assert.match(cmd[1].join(' '),/amix=inputs=2/);
  assert.throws(()=>validatePlan({...f.plan,duck:{windows:[{startSeconds:-1,endSeconds:3}]}}),/between/);
  assert.throws(()=>validatePlan({...f.plan,effects:[{path:f.plan.music.path,atSeconds:3}]}),/between/);
  assert.throws(()=>validatePlan({...f.plan,output:f.plan.music.path}),/m4a/);
 }finally{f.cleanup()}
});
test('Actual FFmpeg rendering yields decodable 48-kHz stereo loop, hash and refuses clobber',()=>{
 const f=fixture();try{
  const result=render(f.plan);
  assert.equal(result.status,'COMPLETE');
  assert.equal(result.clipCount,1);
  assert.equal(result.duckWindows,1);
  assert.equal(result.editorRootVolume,1);
  assert.ok(/^[a-f0-9]{64}$/.test(result.sha256));
  assert.ok(Math.abs(result.durationSeconds-2.4)<0.15);
  assert.ok(statSync(result.output).size>2000);
  const decoded=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-i',result.output,'-f','null','-'],{encoding:'utf8'});
  assert.equal(decoded.status,0,decoded.stderr);
  assert.throws(()=>render(f.plan),/Refusing to overwrite/);
 }finally{f.cleanup()}
});
