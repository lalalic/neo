import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('Director owns optional route, event and hotspot research without inventing visits', () => {
  const editor = read('../agents/vlog-director.agent.md');
  const graph = read('../AGENTS.md');
  for (const term of ['local events', 'hotspots', 'publication review', 'shot-selection.json', '0–3 second']) {
    assert.ok(editor.includes(term), `missing Editor requirement: ${term}`);
  }
  assert.match(editor, /Private previews can use original coordinates/);
  assert.match(graph, /Optional GPS\/local-event research belongs to Director, not a new Stage/);
});

test('Producer requests and Market verifies truthful hooks, personality and locality', () => {
  const market = read('../agents/market.agent.md');
  const producer = read('../agents/vlog-producer.agent.md');
  for (const term of ['first 0–3 seconds', 'authentic personality', 'local event', 'Missing optional context']) {
    assert.ok(market.includes(term), `missing Market gate: ${term}`);
  }
  assert.match(producer, /first 0–3 second hook/);
  assert.match(producer, /never present generated travel footage as observed reality/);
  assert.match(producer, /--agents video-director,market/);
});
