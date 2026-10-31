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
