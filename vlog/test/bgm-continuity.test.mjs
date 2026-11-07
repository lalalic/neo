import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {compileCinematicVlog,lintCinematicVlog} from '../lib/cinematic-vlog.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
test('cinematic Story uses ONE continuous looping root BGM under all scene transitions',()=>{
 const dir=mkdtempSync(join(tmpdir(),'vlog-sound-contract-'));
 const cwd=process.cwd();
 try{
   process.chdir(dir);
   const bytes=['start-media','middle-media','payoff-media','licensed-main-theme'];
   for(const [i,name] of ['hook.mp4','journey.mp4','payoff.mp4','main-theme.mp3'].entries())writeFileSync(name,bytes[i]);
   const scenes=['hook','journey','payoff'].map((id,i)=>({id,beat:i===0?'hook':i===2?'payoff':'development',type:'video',path:`${id}.mp4`,duration:i===0?2:i===2?3:7,authorized:true,sourceHash:hash(bytes[i]),evidenceRef:`manifest#${id}`}));
   const boundaries=[{transition:'fade',seconds:0.25,rationale:'location continuity'},{transition:'fade',seconds:0.25,rationale:'emotional bridge'}];
   const music={path:'main-theme.mp3',authorized:true,sha256:hash(bytes[3]),evidenceRef:'rights#main-theme',catalogReference:'Artlist:133995+133996'};
   const md=compileCinematicVlog({scenes,boundaries,music});
   assert.equal((md.match(/- audio src:main-theme.mp3 isBackground:true/g)||[]).length,1);
   assert.equal((md.match(/isBackground:true volume:0.5/g)||[]).length,1);
   assert.match(md,/layout:series transition:fade transitionTime:0.25/);
   assert.deepEqual(lintCinematicVlog(md,{scenes,boundaries,music}),[]);
 } finally {process.chdir(cwd);rmSync(dir,{recursive:true,force:true});}
});
