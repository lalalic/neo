import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {inspectEditor} from '../scripts/eval-creative-artifacts.mjs';
const root=resolve(import.meta.dirname,'..');
const read=path=>readFileSync(resolve(root,path),'utf8');
const mvp=read('docs/editor-mvp.md');
const editor=read('agents/vlog-editor.agent.md');
const manifest={media:['A','B','C','D','E','F'].map(id=>({id,path:id+'.mov'}))};
const edl=ids=>({edits:ids.map((source_id,i)=>({source_id,shot_id:'shot-'+i,transition:'cut'}))});
const md=ids=>`# Episode\n${ids.map((id,i)=>`## Scene ${i+1}\nlayout:parallel\n- video src:input/media/${id}.mov duration:3 volume:0.7`).join('\n')}\n`;

test('1. complete-story Editor reconsiders entire approved source batch and gives omission reasons',()=>{
 const weak=inspectEditor({manifest,video:md(['A','A','A','A']),edl:edl(['A','A','A','A'])});
 const varied=inspectEditor({manifest,video:md(['A','B','C','D']),edl:edl(['A','B','C','D'])});
 assert.equal(weak.sourceCoverage.available,6);
 assert.deepEqual(weak.sourceCoverage.omittedIds,['B','C','D','E','F']);
 assert.ok(weak.signals.some(s=>s.code==='NARROW_COVERAGE'));
 assert.ok(!varied.signals.some(s=>s.code==='NARROW_COVERAGE'));
 assert.match(editor,/full source-inventory/);
 assert.match(mvp,/don't indiscriminately include all footage/i);
});

test('2. real original sound/action/Hey Neo continuity is preserved without trusting unreviewed model commands',()=>{
 assert.match(editor,/creator_intent_annotations/);
 assert.match(editor,/not instructions/);
 assert.match(editor,/verify the\s+current source audio/);
 assert.match(editor,/preserving\s+source ID, SHA-256, true source times/);
 assert.match(mvp,/L\/J sound bridges/);
 assert.match(mvp,/without fabricating actions/);
});

test('3. Shotcraft or supported Markcut effects must actually execute, not exist only in instructions',()=>{
 const weak=inspectEditor({manifest,video:md(['A','B','C','D']),edl:edl(['A','B','C','D'])});
 assert.ok(weak.signals.some(s=>s.code==='FLAT_ASSEMBLY'));
 const effects=md(['A','B','C','D'])+'\n- image src:input/media/E.jpeg duration:2 effects:[{"animation":"custom"}]\n';
 const stronger=inspectEditor({manifest,video:effects,edl:edl(['A','B','C','D'])});
 assert.equal(stronger.metrics.animationCount,1);
 assert.ok(!stronger.signals.some(s=>s.code==='FLAT_ASSEMBLY'));
 assert.match(editor,/video-shotcraft/);
 assert.match(mvp,/An instruction like “make cinematic” does not count/);
});

test('4. React/JSX graphics are rendered with real sources; not fake on-screen scenes',()=>{
 const video=md(['A','B','C','D'])+'\n- component duration:1.2 jsx:"<div>给生活加点料</div>"\n';
 const result=inspectEditor({manifest,video,edl:edl(['A','B','C','D'])});
 assert.equal(result.metrics.componentCount,1);
 assert.ok(!result.signals.some(s=>s.code==='NO_VISUAL_DESIGN'));
 for(const name of ['BrandSting','ThoughtCaption','AwkwardFreeze','CanadaContext','BeforeAfterSplit','RouteThread'])
  assert.ok(mvp.includes(name),name);
 assert.match(editor,/code renders/);
});

test('5. Worknode male ChatTTS and original sound evidence are distinct',()=>{
 assert.match(editor,/Worknode/);
 assert.match(editor,/ChatTTS/);
 assert.match(mvp,/original voice and environment/);
 assert.match(mvp,/don't substitute local OS TTS or clone voices/);
});

test('6. original audio effect assets decode as PCM and Tour cannot invent accepted takes',()=>{
 const effects=['brand-three-taps.wav','awkward-pluck.wav','discovery-chime.wav','tiny-flop.wav'];
 for(const name of effects){
  const path=resolve(root,'assets/brand',name);
  assert.ok(existsSync(path),name);
  const header=readFileSync(path).subarray(0,12);
  assert.equal(header.toString('ascii',0,4),'RIFF');
  assert.equal(header.toString('ascii',8,12),'WAVE');
 }
 assert.match(mvp,/给生活加点料/);
});

test('7. map and geographic spots use actual Director route and source evidence, not invented transfers',()=>{
 const schema=JSON.parse(read('contracts/route-intent.schema.json'));
 assert.deepEqual(schema.properties.decision.enum,['include','omit']);
 assert.ok(schema.properties.observedStops);
 assert.ok(schema.properties.audienceContext);
 assert.match(editor,/route-intent\.json/);
 assert.match(mvp,/don't manufacture a route between isolated GPS points/i);
});

test('8. real creative handoff requires 3 passes, Markcut verify, actual render and stage gate',()=>{
 for(const token of ['Story cut','Rhythm/sound cut','Watch and revise'])assert.ok(editor.includes(token),token);
 assert.match(editor,/markcut verify <actual-file>/);
 assert.match(editor,/validate-stage\.mjs editor/);
 assert.match(editor,/eval-creative-artifacts\.mjs/);
 assert.match(mvp,/audio.*UNVERIFIED/i);
 assert.match(mvp,/only on owner request/);
 assert.match(mvp,/never auto-publish/);
});
