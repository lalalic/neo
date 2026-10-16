import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EPISODE_STAGES, VLOG_EPISODE_AGENT_GRAPH } from '../lib/episode-graph.mjs';
import { validateLocationEnrichment, validateMusicPlan } from '../lib/episode-evidence.mjs';

test('one episode graph orders route, local research, editing, mandatory music and producer', () => {
  assert.deepEqual(EPISODE_STAGES, ['vlog-route-researcher','vlog-location-researcher','vlog-editor','vlog-music-supervisor','vlog-producer']);
  assert.equal((VLOG_EPISODE_AGENT_GRAPH.match(/-->/g) || []).length, 4);
});
const claim = { id:'stop-1', category:'event', relation:'nearby_at_time', text:'A public market was nearby', event_time:'2026-10-01T15:00:00Z', confidence:0.8, source:{url:'https://example.org/events/market',retrieved_at:'2026-10-14T20:00:00Z'}};
test('enrichment preserves citations, avoids inferred attendance and demands historic weather', () => {
  assert.equal(validateLocationEnrichment({schema_version:1,claims:[claim]}).claims.length,1);
  assert.throws(()=>validateLocationEnrichment({schema_version:1,claims:[{...claim,relation:'observed'}]}),/original media/);
  assert.throws(()=>validateLocationEnrichment({schema_version:1,claims:[{...claim,category:'weather',relation:'historical_context'}]}),/historical observation/);
  assert.throws(()=>validateLocationEnrichment({schema_version:1,claims:[{...claim,source:{url:'http://unsafe.test',retrieved_at:'2026-10-14'}}]}),/HTTPS provenance/);
});
test('BGM required: only licensed audible cues qualify as metadata-ready', () => {
  assert.deepEqual(validateMusicPlan({schema_version:1,status:'INPUT_NEEDED',reason:'No authorized track'}).ready,false);
  const plan={schema_version:1,status:'READY',asset:{uri:'assets/bg.wav',license:{evidence:'receipt-1',authorized_usage:'private Vlog'}},cues:[{start:0,end:8,gain:.2}]};
  assert.equal(validateMusicPlan(plan).ready,true);
  assert.throws(()=>validateMusicPlan({...plan,asset:{uri:'bgm.mp3'}}),/permission evidence/);
  assert.throws(()=>validateMusicPlan({...plan,cues:[{start:0,end:8,gain:0}]}),/audible/);
});

test('every workflow specialist is discoverable by its YAML name', () => {
  for (const name of EPISODE_STAGES) {
    const text = readFileSync(new URL(`../agents/${name}.agent.md`, import.meta.url), 'utf8');
    assert.match(text, new RegExp(`^name: ${name}$`, 'm'));
    assert.match(text, /^type: worker$/m);
  }
});
