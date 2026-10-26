import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('Editor owns optional route, event and hotspot research without inventing visits', () => {
  const editor = read('../agents/vlog-editor.agent.md');
  const graph = read('../AGENTS.md');
  for (const term of ['location-enrichment.json', 'verified recorded visit', 'external context only', 'NOT_APPLICABLE', 'inferred, not recorded tracks', 'opening 0–3 second shot']) {
    assert.ok(editor.includes(term), `missing Editor requirement: ${term}`);
  }
  assert.match(editor, /without explicit approval/);
  assert.match(graph, /Research is optional and does not add Graph nodes/);
});

test('Producer requests and Market verifies truthful hooks, personality and locality', () => {
  const market = read('../agents/market.agent.md');
  const producer = read('../agents/vlog-producer.agent.md');
  for (const term of ['first 0–3 seconds', 'authentic personality', 'local event', 'Missing optional context']) {
    assert.ok(market.includes(term), `missing Market gate: ${term}`);
  }
  assert.match(producer, /first 0–3 second hook/);
  assert.match(producer, /fabricated visit, private location disclosure/);
  assert.match(producer, /--agents video-director,market/);
});
