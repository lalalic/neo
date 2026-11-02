import test from 'node:test';
import assert from 'node:assert/strict';
import {insertGeoRoute,gpsSourceFiles} from '../lib/cinematic-episode.mjs';
const base={scenes:[{id:'hook',beat:'hook'},{id:'middle',beat:'journey'},{id:'end',beat:'payoff'}],boundaries:[{transition:'fade',rationale:'source narrative',seconds:0.25},{transition:'fade',rationale:'payoff',seconds:0.25}]};
test('mandatory Route enters after the hook without replacing any original clip',()=>{
 const inpt=structuredClone(base);const got=insertGeoRoute(inpt,{required:true,path:'assets/route.mp4',duration:15,sha256:'f'.repeat(64),evidenceRef:'geo-story/evidence.json'});
 assert.deepEqual(got.scenes.map(s=>s.id),['hook','gps-geography','middle','end']);
 assert.equal(got.boundaries.length,3);assert.equal(inpt.scenes.length,3);assert.equal(got.scenes[1].volume,1);
});
test('normal no-GPS episode retains the exact source storyboard',()=>assert.equal(insertGeoRoute(base,{required:false}),base));
test('corrupt boundary and duplicate route fail instead of degrading silently',()=>{
 assert.throws(()=>insertGeoRoute({...base,boundaries:[]},{required:true}),/Missing Editor/);
 assert.throws(()=>insertGeoRoute({...base,scenes:[...base.scenes,{id:'gps-geography'}]},{required:true}),/already inserted/);
});

test('always scan source originals even if a geo.media supplement is supplied',()=>{
 const x={scenes:[{path:'assets/a.jpg'},{path:'assets/b.jpg',sourceEvidencePath:'original/b.mov'}],geo:{media:['assets/a.jpg','assets/c.jpg']}};
 assert.deepEqual(gpsSourceFiles(x),['assets/a.jpg','original/b.mov','assets/c.jpg']);
 assert.deepEqual(gpsSourceFiles({scenes:[{path:'assets/a.jpg'}]}),['assets/a.jpg']);
});

test('Director places the real route at the narrative turn, with transitions on both sides',()=>{
 const input={...structuredClone(base),geo:{insertAfterSceneId:'middle',storyIntent:'Explain the landscape before the final payoff'}};
 const got=insertGeoRoute(input,{required:true,path:'assets/route.mp4',duration:8,sha256:'a'.repeat(64),evidenceRef:'gps-evidence'});
 assert.deepEqual(got.scenes.map(s=>s.id),['hook','middle','gps-geography','end']);
 assert.equal(got.scenes[2].intent,input.geo.storyIntent);
 assert.equal(got.boundaries.length,3);
 assert.ok(got.boundaries[1].rationale.includes('gps-evidence'));
 assert.ok(got.boundaries[2].rationale.includes('payoff'));
 assert.ok(got.boundaries.every(b=>b.transition==='fade'));
 assert.throws(()=>insertGeoRoute({...input,geo:{insertAfterSceneId:'end'}},{required:true}),/before payoff/);
});

// Explicit Director decisions outrank automatic GPS discovery in the real builder.
test('build script respects an explicit Director mapless decision even with GPS metadata',async()=>{
 const {readFileSync}=await import('node:fs');
 const code=readFileSync(new URL('../lib/cinematic-episode.mjs',import.meta.url),'utf8');
 assert.match(code,/input\.geo\?\.required===false/);
 assert.match(code,/Director selected a mapless story/);
});
