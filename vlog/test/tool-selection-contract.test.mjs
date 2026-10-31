import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);
const rules = readFileSync(new URL('AGENTS.md', root), 'utf8');
const graph = readFileSync(new URL('graph.mmd', root), 'utf8');

test('Vlog agents discover CapCut dynamically and choose it only when useful', () => {
  const selection = rules.split('## Agent-driven media tool selection')[1]
    ?.split('## Production quality')[0];
  assert.ok(selection, 'shared Vlog agent instructions must own the policy');
  assert.match(selection, /capcut-mcp/);
  assert.match(selection, /`mcp.capcut`.*inventory/);
  assert.match(selection, /`help`/);
  assert.match(selection, /Do not hard-code a fixed CapCut command list/);
  assert.match(selection, /Do not invoke tools solely because/);
  assert.match(selection, /Director.*Editor.*Producer/s);
});

test('CapCut cannot replace Markcut or bypass consent and source verification', () => {
  const selection = rules.split('## Agent-driven media tool selection')[1]
    ?.split('## Production quality')[0] ?? '';
  for (const required of [
    'Markcut STT/VTT/vision', 'edit-decision-list.json', 'video.md',
    'Markcut Preview', 'explicit approval', 'credit cost', 'licenses/rights',
    'NOT_APPLICABLE', 'Never claim an unverified asset was imported',
  ]) {
    assert.ok(selection.includes(required), `Missing CapCut safeguard: ${required}`);
  }
});

test('CapCut introduces no new Stage or duplicate Vlog agent', () => {
  assert.doesNotMatch(graph, /capcut/i);
  assert.match(graph, /visioner.*director/);
  assert.match(graph, /director.*editor/);
  assert.match(graph, /editor.*producer/);
});
