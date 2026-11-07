import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {compileCinematicVlog,lintCinematicVlog,parseCinematicTemplate} from '../lib/cinematic-vlog.mjs';

const template = readFileSync(new URL('../templates/cinematic-vlog.md',import.meta.url),'utf8');
const hash=content=>createHash('sha256').update(content).digest('hex');

function fixture(fn){
 const dir=mkdtempSync(join(tmpdir(),'markcut-md-template-'));
 const cwd=process.cwd();
 try{
  process.chdir(dir);
  const paths=['hook.mp4','story.png','payoff.mp4','sound.m4a'];
  for(const [i,path] of paths.entries())writeFileSync(path,'synthetic-mock-source-'+i);
  const scenes=paths.slice(0,3).map((path,i)=>({
    id:['opening','journey','ending'][i],beat:['hook','development','payoff'][i],
    type:i===1?'image':'video',path,duration:2,authorized:true,
    sourceHash:hash(readFileSync(path)),evidenceRef:'synthetic#'+i
  }));
  const boundaries=[{transition:'fade',rationale:'real story continuity'},{transition:'fade',rationale:'story payoff'}];
  const music={path:'sound.m4a',authorized:true,sha256:hash(readFileSync('sound.m4a')),
    evidenceRef:'synthetic fixture only',catalogReference:'Artlist:133995+133996'};
  return fn({scenes,boundaries,music});
 }finally{process.chdir(cwd);rmSync(dir,{recursive:true,force:true});}
}

test('only a Markcut MD controls BGM selection, audio volume and hook/body/closing scene structure',()=>{
 const parsed=parseCinematicTemplate();
 assert.equal(parsed.config.song.title,'Good Times');
 assert.equal(parsed.config.song.artist,'Rynn');
 assert.equal(parsed.config.song.license_status,'unverified');
 assert.ok(!existsSync(new URL('../templates/cinematic-vlog-style.json',import.meta.url)));
 assert.ok(!existsSync(new URL('../config/theme-song.json',import.meta.url)));
 assert.equal((parsed.body.match(/- audio src:/g)||[]).length,1);
 fixture(input=>{
   const baseline=compileCinematicVlog(input);
   assert.match(baseline,/BGM Good Times — Rynn/);
   assert.match(baseline,/- audio src:sound.m4a isBackground:true volume:0.18/);
   assert.equal((baseline.match(/isBackground:true volume:0.18/g)||[]).length,1);
   assert.match(baseline,/## opening/);
   assert.match(baseline,/## journey/);
   assert.match(baseline,/## ending/);
   assert.deepEqual(lintCinematicVlog(baseline,input),[]);
   const edited=template
     .replace('src:{{music.path}} isBackground:true volume:{{music.volume}}',
              'src:{{music.path}} isBackground:true volume:0.36')
     .replace('## {{scene.id}}\nlayout:parallel','## Hook {{scene.id}}\nlayout:parallel')
     .replace('\"end\": \"scale(1.08)\"','\"end\": \"scale(1.12)\"');
   const altered=compileCinematicVlog(input,{templateContent:edited});
   assert.match(altered,/volume:0.36/);
   assert.match(altered,/## Hook opening/);
   assert.match(altered,/scale\(1\.12\)/);
   assert.deepEqual(lintCinematicVlog(altered,input,{templateContent:edited}),[]);
   assert.notEqual(baseline,altered);
   // Untrusted run JSON has no right to silently replace the source template.
   assert.equal(compileCinematicVlog({...input,template:edited}),baseline);
 });
});

test('pre-ducked narration soundtrack stays audible; unprocessed tracks stay at the quieter gain',()=>{
 fixture(input=>{
  const mixed={...input,music:{...input.music,preMixedDucking:true,duckingEvidenceRef:'synthetic sidechain mix record'}};
  mixed.scenes=mixed.scenes.map(scene=>({...scene,audioIntent:'narration'}));
  const output=compileCinematicVlog(mixed);
  assert.match(output,/- audio src:sound.m4a isBackground:true volume:0.9/);
  assert.doesNotMatch(output,/isBackground:true volume:0.18/);
  assert.deepEqual(lintCinematicVlog(output,mixed),[]);
  assert.throws(()=>compileCinematicVlog({...mixed,music:{...mixed.music,duckingEvidenceRef:undefined}}),/pre-mixed ducked/);
 });
});

test('a run cannot substitute an unrelated BGM even when file exists and hash matches',()=>{
 fixture(input=>{
   assert.throws(()=>compileCinematicVlog({...input,music:{...input.music,catalogReference:'Other:random'}}),
     /BGM_SOURCE_MISMATCH/);
   assert.throws(()=>compileCinematicVlog({...input,music:{...input.music,catalogReference:undefined}}),
     /BGM_SOURCE_MISMATCH/);
   assert.throws(()=>compileCinematicVlog({...input,music:{...input.music,path:'missing-song.m4a'}}),
     /MISSING_TEMPLATE_SONG/);
   // Private preview selection does not block on license verification.
   assert.match(compileCinematicVlog({...input,music:{...input.music,authorized:false}}),/BGM Good Times/);
 });
});

test('run-local song override cannot disguise unrelated synthesized music as template song',()=>{
 fixture(input=>{
  const bad=template.replace('Good Times','Autumn Synth').replace('Rynn','New Producer');
  assert.throws(()=>compileCinematicVlog(input,{templateContent:bad}),/TEMPLATE_SONG_OVERRIDE_FORBIDDEN/);
 });
});

test('Markcut template references for geo and route scene shape are executable, not unreferenced prose',()=>{
 const geo=readFileSync(new URL('../templates/geo-story.md',import.meta.url),'utf8');
 const route=readFileSync(new URL('../templates/route-overview.md',import.meta.url),'utf8');
 assert.match(geo,/VLOG:MAP_SCENE:BEGIN/);
 assert.match(geo,/layout:parallel/);
 assert.match(geo,/- audio src:{{scene.audio.path}}/);
 assert.match(geo,/view:route/);
 assert.match(route,/layout:series/);
 assert.match(route,/{{map}}/);
 const code=readFileSync(new URL('../lib/geo-story.mjs',import.meta.url),'utf8');
 assert.match(code,/geoTemplate/);
 assert.match(code,/geoRender\('MAP_SCENE'/);
 assert.match(code,/geoRender\('MAP_ROUTE'/);
});
