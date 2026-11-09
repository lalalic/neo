import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => readFileSync(path.join(root, name), 'utf8');

// Regression for actual role prompt assembly: this contract must be reachable
// from both Stage agents, not merely present in an unreferenced research note.
test('Director and Editor both load a single audience-first editing contract', () => {
  const doc = 'docs/audience-first-storycraft.md';
  assert.ok(existsSync(path.join(root, doc)));
  for (const role of ['agents/vlog-director.agent.md', 'agents/vlog-editor.agent.md']) {
    assert.match(read(role), /\]\(\.\.\/docs\/audience-first-storycraft\.md\)/);
  }
  assert.match(read('docs/personal-story-first.md'), /\]\(audience-first-storycraft\.md\)/);
});

test('creative guidance protects real footage, personal voice and non-forced endings', () => {
  const director = read('agents/vlog-director.agent.md');
  const editor = read('agents/vlog-editor.agent.md');
  const guide = read('docs/audience-first-storycraft.md');
  assert.match(director, /source-deliverable viewer promise/);
  assert.match(director, /never invent tension/);
  assert.match(director, /Do not pad narration/);
  assert.match(editor, /source sound\/picture continuity/);
  assert.match(editor, /gesture\/reaction continuity/);
  assert.match(guide, /not\*\* an automated publish gate/);
  assert.match(guide, /Direct XHS post inspection may be blocked/);
});
