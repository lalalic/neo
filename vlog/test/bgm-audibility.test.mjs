import test from 'node:test';
import assert from 'node:assert/strict';
import {rootBackgroundMusic,evaluateMusicAudibility} from '../lib/bgm-audibility.mjs';

const old='- audio src:assets/music/old.m4a isBackground:true volume:0.7';
const improved='- audio src:assets/music/balanced.m4a isBackground:true volume:0.7';

test('old already-ducked -29.1dB source fails after root attenuation',()=>{
 const spec=rootBackgroundMusic('# video\n'+old);
 assert.deepEqual(spec,{src:'assets/music/old.m4a',volume:0.7});
 assert.throws(()=>evaluateMusicAudibility(spec,'[Parsed_volumedetect] mean_volume: -29.1 dB'),
   /BGM_INAUDIBLE.*-32\.2 dBFS/);
});

test('balanced -22.6dB source passes at unchanged 0.7 root gain',()=>{
 const spec=rootBackgroundMusic('# video\n'+improved);
 assert.deepEqual(evaluateMusicAudibility(spec,'mean_volume: -22.6 dB'),{
   sourceMeanDbFS:-22.6,playedMeanDbFS:-25.7,rootVolume:0.7,minimumMeanDbFS:-30,pass:true
 });
});

test('silence, missing level and invalid gain never produce false PASS',()=>{
 assert.throws(()=>evaluateMusicAudibility(rootBackgroundMusic(old),'mean_volume: -inf dB'),/BGM_INAUDIBLE/);
 assert.throws(()=>evaluateMusicAudibility(rootBackgroundMusic(old),'invalid log'),/BGM_MEASUREMENT_MISSING/);
 assert.throws(()=>rootBackgroundMusic(old.replace('volume:0.7','volume:0')),/BGM_SPEC_INVALID/);
 assert.equal(rootBackgroundMusic('# video\nwidth:720'),null);
});

import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {run as produce} from '../agents/.shortcut/vlog-producer.agent.mjs';

async function fixture(t){
 const base=await mkdtemp(join(tmpdir(),'neo-vlog-bgm-audit-'));
 t.after(()=>rm(base,{force:true,recursive:true}));
 const project=join(base,'vlog');
 const run=join(project,'runs','2026-11-07-bgm-audit');
 await mkdir(join(run,'assets','music'),{recursive:true});
 await mkdir(join(run,'output'),{recursive:true});
 await writeFile(join(run,'assets','music','song.m4a'),'fixture');
 await writeFile(join(run,'video.md'),
   '# video\nwidth:720 height:1280 fps:30 layout:series\n\n- audio src:assets/music/song.m4a isBackground:true volume:0.7\n');
 return {project,run};
}

test('Producer refuses quiet BGM before any render side effects',async t=>{
 const f=await fixture(t);
 const commands=[];
 const ctx={input:{projectPath:f.project,runPath:f.run},runCommand:async args=>{
   commands.push(args);
   if(args[0]==='ffmpeg')return {code:0,stderr:'mean_volume: -29.1 dB'};
   return {code:0,stdout:'Valid'};
 }};
 await assert.rejects(produce(ctx),/BGM_INAUDIBLE/);
 assert.deepEqual(commands.map(args=>args[0]),['markcut','ffmpeg']);
});

test('Producer records measured audible BGM as a durable receipt',async t=>{
 const f=await fixture(t);
 const commands=[];
 const ctx={input:{projectPath:f.project,runPath:f.run},runCommand:async args=>{
   commands.push(args);
   if(args[0]==='ffmpeg')return {code:0,stderr:'mean_volume: -22.6 dB'};
   if(args[1]==='render'){
     await writeFile(join(f.run,'output','video.mp4'),'rendered video');
     return {code:0};
   }
   if(args[0]==='ffprobe')return {code:0,stdout:JSON.stringify({
     streams:[{codec_type:'video'},{codec_type:'audio'}],format:{duration:'53.482667'}})};
   if(args[1]?.endsWith('validate-stage.mjs'))
     return {code:0,stdout:JSON.stringify({status:'PASS'})};
   return {code:0,stdout:'Valid'};
 }};
 const result=await produce(ctx);
 assert.equal(result.output.bgmAudibility.playedMeanDbFS,-25.7);
 const receipt=JSON.parse(await readFile(join(f.run,'production-receipt.json'),'utf8'));
 assert.equal(receipt.bgmAudibility.pass,true);
 assert.equal(commands.length,5);
 assert.equal(commands[1][0],'ffmpeg');
 assert.equal(commands[2][1],'render');
});
