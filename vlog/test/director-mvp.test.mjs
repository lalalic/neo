import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {buildVisionEvidence} from '../agents/vlog-visioner.agent.mjs';
import {resolve} from 'node:path';
import {collectDirectorMvpCues,preflight} from '../scripts/director-mvp-preflight.mjs';
import {validateHookFocus,pillars} from '../scripts/director-hooks-to-md.mjs';
const root=resolve(import.meta.dirname,'..');
const read=x=>readFileSync(resolve(root,x),'utf8');
const agent=read('agents/vlog-director.agent.md');
const mvp=read('docs/director-mvp.md');
const six=['ai','it_work','work_permit_pr','family_education','travel_explore','midlife'];
const media=(...ids)=>({media:ids.map(id=>({id,path:id+'.mov'}))});

test('1. six primary directions are a source-linked selection (not a forced six-topic mix)',()=>{
 const schema=JSON.parse(read('contracts/personal-story.schema.json'));
 assert.deepEqual(schema.definitions.content_pillar.enum,six);
 assert.deepEqual(Object.keys(pillars),six);
 assert.match(agent,/channel_focus/);
 assert.match(mvp,/only source-relevant ones/);
});

test('2. a reviewed Hook is audience-oriented and has a real, explicitly chosen main direction',()=>{
 assert.equal(validateHookFocus({id:'walking',primary_pillar:'travel_explore',viewer_reason:'想知道加拿大普通人周末有什么体验',media:[{source_id:'clip-A'}]},'travel_explore'),'加国旅探 / 生活');
 assert.throws(()=>validateHookFocus({id:'empty',primary_pillar:'ai',viewer_reason:'好看',media:[{source_id:'clip-A'}]},'ai'),/viewer reason/);
 assert.match(agent,/Hook should lead into a complete multi-beat story/);
});

test('3. complete personal-story contract and source-batch decisions, never just a micro-split',()=>{
 const schema=JSON.parse(read('contracts/personal-story.schema.json'));
 for(const k of ['narrative','arc','beats','provenance'])assert.ok(schema.required.includes(k),k);
 assert.match(agent,/素材盘点与取舍理由/);
 assert.match(agent,/Prefer integrating as much genuinely useful provided media/);
 assert.match(agent,/imagination for interpretation, not invented history/i);
});

test('4. interactive request is strictly on demand, Relay owns decisions not mere Preview delivery',()=>{
 assert.match(agent,/Default \*\*OFF\*\*/);
 assert.match(agent,/review-stages\.json/);
 assert.match(agent,/neo mcp call markcut\.preview --args-file/);
 assert.match(agent,/AWAITING_DECISION/);
 assert.match(agent,/PENDING, not approval/);
});

test('5. route+spots fallback remains factual, not invented travel across isolated locations',()=>{
 const route=JSON.parse(read('contracts/route-intent.schema.json'));
 assert.deepEqual(route.properties.decision.enum,['include','omit']);
 for(const k of ['observedStops','audienceContext'])assert.ok(route.properties[k]);
 assert.match(agent,/weak-story fallback/);
 assert.match(mvp,/observed spot is not proof of a traveled route/i);
 assert.match(mvp,/Do not manufacture a problem/);
});

test('6. Director consumes canonical Visioner annotations, never repeats raw STT/VTT parsing',()=>{
 const manifest=media('A','B','C');
 const annotation={annotation_id:'B:2000to4000:intent:1',evidence_id:'B:2000to4000',
  source_id:'B',source_time_start_seconds:2,source_time_end_seconds:4,
  source_time_seconds:2.9,utterance:'嘿 Neo 留下这个表情',intent_hint:'keep important reaction',
  confidence_hint:'high',status:'MODEL_OUTPUT_UNREVIEWED',note:'Not confirmed'};
 const next={...annotation,annotation_id:'C:5000to8000:intent:0',evidence_id:'C:5000to8000',
  source_id:'C',source_time_start_seconds:5,source_time_end_seconds:8,
  utterance:'然后加点幽默字幕',intent_hint:'caption'};
 const r=collectDirectorMvpCues({manifest,vision:{sources:[{source_id:'A'},{source_id:'B'},{source_id:'C'}],
  creator_intent_annotations:[annotation,next]}});
 assert.deepEqual(r.prioritySourceIds,['B','C']);
 assert.equal(r.sourceInventory.length,3);
 assert.equal(r.heyNeoCandidates[0].source_id,'B');
 assert.equal(r.heyNeoCandidates[0].intent_hint,'keep important reaction');
 assert.equal(r.heyNeoCandidates[1].source_id,'C');
 assert.equal(r.heyNeoCandidates[1].utterance,'然后加点幽默字幕');
 assert.equal(r.annotationSource,'vision-evidence.json.creator_intent_annotations');
 assert.match(r.policy,/Listen to original source audio/);
 assert.equal(r.status,'PREVIEW_UNVERIFIED_NOT_AN_EDIT_DECISION');
 const clear=collectDirectorMvpCues({manifest,vision:{sources:[{source_id:'A'}],creator_intent_annotations:[]},
  metadata:{B:{perception:{segments:{'2to4':{instructions:[{utterance:'Hey Neo keep',intent:'keep'}]}}}}}});
 assert.deepEqual(clear.heyNeoCandidates,[]);
 assert.deepEqual(clear.prioritySourceIds,[]);
 const legacy=collectDirectorMvpCues({manifest,vision:{sources:[{source_id:'A'}]}});
 assert.match(legacy.legacyNote,/predates intent annotations/);
});

test('7. real human action and sound are required to substantiate quotation and story payoff',()=>{
 assert.match(agent,/inspect short original-video/);
 assert.match(agent,/listen to original audio BEFORE choosing/);
 assert.match(agent,/Quote original dialogue only after listening/);
 assert.match(mvp,/Human action and reaction usually provide story choices/);
});

test('8. private indexed history guides continuity, not invented current events',()=>{
 assert.match(agent,/story-history\.mjs search/);
 assert.match(agent,/story-history\.mjs inspect/);
 assert.match(agent,/never as current-Run evidence/);
 assert.match(mvp,/Missing history does not block the Run/);
});

test('real approved source batch carries a simulated Markcut segment cue end-to-end to Director',()=>{
 const run=resolve(root,'runs/2026-11-07-shortcut-fresh-no-review-e2e');
 const manifestBytes=readFileSync(join(run,'source-manifest.json'));
 const manifest=JSON.parse(manifestBytes.toString('utf8'));
 const metadata=JSON.parse(readFileSync(join(run,'input/media/metadata.json'),'utf8'));
 const chosen=manifest.media.find(m=>Object.keys(metadata[m.id]?.perception?.segments??{}).length);
 assert.ok(chosen,'real Run should have at least one semantic segment');
 const segment=Object.entries(metadata[chosen.id].perception.segments)[0];
 const [start,end]=segment[0].split('to').map(Number);
 const time=(start+end)/2000;
 segment[1].instructions=[{utterance:'嘿 Neo 留下这一小段',intent:'keep_this_moment',time_seconds:time,confidence:'high'}];
 const bytes=Buffer.from(JSON.stringify(metadata));
 const evidence=buildVisionEvidence(manifest,metadata,join(run,'input','media'),manifestBytes,bytes);
 const director=collectDirectorMvpCues({manifest,vision:evidence});
 assert.ok(director.prioritySourceIds.includes(chosen.id));
 assert.equal(director.heyNeoCandidates.find(x=>x.source_id===chosen.id).intent_hint,'keep_this_moment');
 assert.equal(director.heyNeoCandidates.find(x=>x.source_id===chosen.id).source_time_seconds,time);
 assert.equal(director.annotationSource,'vision-evidence.json.creator_intent_annotations');
 // This injection is in memory only; the original Run and its review state are untouched.
});

test('real existing approved Run can be preflighted read-only with complete inventory',()=>{
 const r=preflight(resolve(root,'runs/2026-11-07-shortcut-fresh-no-review-e2e'));
 assert.equal(r.sourceInventory.length,6);
 assert.ok(r.sourceInventory.every(x=>x.has_vision_evidence));
 assert.equal(r.status,'PREVIEW_UNVERIFIED_NOT_AN_EDIT_DECISION');
});
