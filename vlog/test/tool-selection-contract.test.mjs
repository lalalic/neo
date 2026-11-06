import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);
const rules = readFileSync(new URL('AGENTS.md', root), 'utf8');
const graph = readFileSync(new URL('graph.mmd', root), 'utf8');
const optional = readFileSync(new URL('docs/optional-media-tools.md', root), 'utf8');

test('Vlog workers load optional CapCut instructions only when evidence makes them relevant', () => {
  assert.match(rules,/Markcut/);
  assert.match(optional,/conditional reference, not part of normal Worker startup/);
  assert.match(optional,/capcut-mcp/);
  assert.match(optional,/mcp\.capcut/);
  assert.match(optional,/help/);
  assert.match(optional,/Do not invoke tools solely because/);
});

test('optional CapCut cannot replace Markcut or bypass consent and source verification', () => {
  for (const required of [
    'Markcut STT/VTT/vision','edit-decision-list.json','video.md',
    'Markcut Preview','explicit approval','credit',
    'licenses/rights','NOT_APPLICABLE','Never claim an unverified asset was imported',
  ]) assert.ok(optional.includes(required), 'Missing optional-tool safeguard: ' + required);
});

test('CapCut introduces no new Stage or duplicate Vlog agent', () => {
  assert.doesNotMatch(graph, /capcut/i);
  assert.match(graph, /visioner.*director/);
  assert.match(graph, /director.*editor/);
  assert.match(graph, /editor.*producer/);
});
