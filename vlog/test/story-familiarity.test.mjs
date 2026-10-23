import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = relative => readFileSync(new URL(relative, import.meta.url), 'utf8');
test('five source-grounded checks are in the story and production contracts', () => {
  const contract = read('../docs/story-familiarity-review.md');
  const editor = read('../agents/vlog-editor.agent.md');
  const producer = read('../agents/vlog-producer.agent.md');
  const stages = read('../docs/episode-stage-contract.md');
  for (const question of ['Authentic situation', 'Inner thoughts', 'Familiar voice', 'Audience takeaway', 'Information density']) assert.ok(contract.includes(question));
  for (const status of ['PASS', 'REVISE', 'NOT_APPLICABLE']) assert.ok(contract.includes(status));
  assert.match(contract, /Never invent failures/);
  assert.match(contract, /Do not infer private thoughts/);
  assert.match(editor, /audience familiarity review/);
  assert.match(producer, /Video Director and Market must check/);
  assert.match(stages, /audience familiarity review/);
});
