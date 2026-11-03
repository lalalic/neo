import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateStoryContext } from '../scripts/check-story-context.mjs';

const story = () => ({
  title: 'Synthetic Drama', provider_id: 'rs-boost', synopsis: 'Two fictional characters disagree.',
  sources: [{kind: 'official_web', url: 'https://example.org/drama', observed_at: '2026-11-03T12:00:00Z'}],
  characters: [
    {name: 'Alex', description: 'First character', relationships: [{to: 'Sam', type: 'friend'}]},
    {name: 'Sam', description: 'Second character'},
  ],
  speaker_map: [],
});
const evidence = (kind, start_s) => ({kind, start_s, end_s: start_s + 1, observation: `Observed ${kind}`});

test('source-backed story context may exist before speaker identification', () => {
  assert.deepEqual(validateStoryContext(story()), []);
  const schema = JSON.parse(readFileSync(new URL('../contracts/story-context.schema.json', import.meta.url)));
  assert.ok(schema.required.includes('sources'));
  assert.ok(schema.required.includes('speaker_map'));
  assert.ok(schema.properties.sources.items.properties.kind.enum.includes('official_web'));
  assert.ok(schema.properties.sources.items.properties.kind.enum.includes('provider_api'));
});

test('diarization does not invent character identities', () => {
  const doc = story();
  doc.speaker_map = [{speaker_id: 'speaker_01', character_name: null, status: 'unresolved', evidence: []}];
  assert.deepEqual(validateStoryContext(doc), []);
  doc.speaker_map[0].character_name = 'Alex';
  assert.match(validateStoryContext(doc).join(';'), /unresolved speaker must not/);
});

test('verified speaker requires a sourced name and independent alignment and identity observations', () => {
  const doc = story();
  const s = {speaker_id: 'speaker_01', character_name: 'Alex', status: 'verified', evidence: [evidence('on_screen_name', 1), evidence('face_lip_sync', 2)]};
  doc.speaker_map = [s];
  assert.deepEqual(validateStoryContext(doc), []);
  s.character_name = 'Invented';
  assert.match(validateStoryContext(doc).join(';'), /not in sourced roster/);
  s.character_name = 'Alex';
  s.evidence = [evidence('voice_consistency', 2), evidence('face_lip_sync', 3)];
  assert.match(validateStoryContext(doc).join(';'), /independent name and audio\/face alignment/);
  s.evidence = [evidence('on_screen_name', 1), evidence('on_screen_name', 2)];
  assert.match(validateStoryContext(doc).join(';'), /independent name and audio\/face alignment/);
});

test('timestamps and duplicate speakers are checked', () => {
  const doc = story();
  const s = {speaker_id: 'speaker_01', character_name: 'Sam', status: 'candidate', evidence: [evidence('direct_dialogue', 4)]};
  doc.speaker_map = [s, {...s, evidence: [evidence('direct_dialogue', 3)]}];
  assert.match(validateStoryContext(doc).join(';'), /duplicate speaker ID/);
  doc.speaker_map.pop();
  s.evidence[0].end_s = 1;
  assert.match(validateStoryContext(doc).join(';'), /evidence\[0\] invalid/);
});

test('producer and planner consume official provenance and never assert identity based on synopsis alone', () => {
  const producer = readFileSync(new URL('../agents/distribution-producer.agent.md', import.meta.url), 'utf8');
  const planner = readFileSync(new URL('../agents/distribution-planner.agent.md', import.meta.url), 'utf8');
  const rights = readFileSync(new URL('../agents/distribution-rights.agent.md', import.meta.url), 'utf8');
  const campaign = JSON.parse(readFileSync(new URL('../contracts/campaign-plan.schema.json', import.meta.url)));
  assert.ok(campaign.properties.story_context_path);
  assert.match(planner, /story_context_path/);
  assert.match(producer, /original licensed episode/);
  assert.match(producer, /status:unresolved/);
  assert.match(rights, /official provider summary/);
});
