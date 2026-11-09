import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {collectDirectorMvpCues,hasHeyNeo,preflight} from '../scripts/director-mvp-preflight.mjs';
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

test('6. Hey/Hei Neo candidates outrank ordinary material for listening, not automatic execution',()=>{
 for(const utterance of ['嘿 Neo 保留这段','Hey Neo, keep the reaction','hei neo 加一个字幕','嗨Neo 留下环境声'])
  assert.equal(hasHeyNeo(utterance),true,utterance);
 assert.equal(hasHeyNeo('No command, a quiet footpath'),false);
 const manifest=media('A','B','C');
 const metadata={B:{perception:{segments:{'2to4':{instructions:[
  {utterance:'嘿 Neo 留下这个表情',intent:'keep important reaction',time_seconds:2.9,confidence:'high'}]}}}}};
 const r=collectDirectorMvpCues({manifest,vision:{sources:[{source_id:'A'},{source_id:'B'},{source_id:'C'}]},metadata,
  vttBySource:{C:'WEBVTT\n\n00:00:05.000 --> 00:00:08.000\nhey neo 加点搞笑的字幕',A:'WEBVTT\n\n00:00:00.000 --> 00:00:03.000\n那天天气挺好'}});
 assert.deepEqual(r.prioritySourceIds,['B','C']);
 assert.equal(r.sourceInventory.length,3);
 assert.equal(r.heyNeoCandidates[0].source_id,'B');
 assert.equal(r.heyNeoCandidates[0].origin,'markcut_segment_instruction_unverified');
 assert.equal(r.heyNeoCandidates[1].source_id,'C');
 assert.equal(r.heyNeoCandidates[1].origin,'source_vtt_unverified');
 assert.match(r.policy,/Listen to actual source sound/);
 assert.equal(r.status,'PREVIEW_UNVERIFIED_NOT_AN_EDIT_DECISION');
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

test('real existing approved Run can be preflighted read-only with complete inventory',()=>{
 const r=preflight(resolve(root,'runs/2026-11-07-shortcut-fresh-no-review-e2e'));
 assert.equal(r.sourceInventory.length,6);
 assert.ok(r.sourceInventory.every(x=>x.has_vision_evidence));
 assert.equal(r.status,'PREVIEW_UNVERIFIED_NOT_AN_EDIT_DECISION');
});
