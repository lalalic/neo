import test from 'node:test';
import assert from 'node:assert/strict';
import { appendTourRecording, selectTourReferences, validateTourDirector } from '../lib/tour-director-index.mjs';

const fixture = { version: 1, tour_id: 'stories', shots: [{ id: 'pv01', title: 'opening', notes: { topic: 'daily_life' }, library: { recordings: [], active_recording_id: null, use_policy: { public_insert: false } } }, { id: 'pv02', title: 'self mock', notes: { topic: 'self_deprecation' }, library: { recordings: [], active_recording_id: null, use_policy: { public_insert: false } } }] };
const sha = 'a'.repeat(64);
const evidence = recording_id => ({ recording_id, media_path: `2026-10-26-tour-voice-kit/media/${recording_id}.mov`, sha256: sha, duration_s: 22, captured_at: '2026-10-26T23:00:00Z', source_tour_session_id: 'session-1', source_media_reference: '/files/test.mov' });

test('Tour Director is a valid mobile manifest and an initially empty private index', () => {
  assert.deepEqual(validateTourDirector(fixture), []);
  assert.equal(fixture.shots.length, 2);
  assert.deepEqual(selectTourReferences(fixture), []);
});

test('archived recordings become selectable, replacement preserves older take', () => {
  const first = appendTourRecording(fixture, 'pv02', evidence('take-1'));
  const next = appendTourRecording(first, 'pv02', evidence('take-2'));
  assert.equal(next.shots[1].library.recordings.length, 2);
  assert.equal(next.shots[1].library.active_recording_id, 'take-2');
  assert.equal(selectTourReferences(next, { topics: ['self_deprecation'] })[0].recording_id, 'take-2');
  assert.deepEqual(selectTourReferences(next, { publicInsert: true }), []);
});

test('rejects unsafe file references and duplicate take IDs', () => {
  assert.throws(() => appendTourRecording(fixture, 'pv02', { ...evidence('take-1'), media_path: '../secret.mov' }));
  const next = appendTourRecording(fixture, 'pv02', evidence('take-1'));
  assert.throws(() => appendTourRecording(next, 'pv02', evidence('take-1')));
});
