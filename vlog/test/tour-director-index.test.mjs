import test from 'node:test';
import assert from 'node:assert/strict';
import { appendTourRecording, selectTourReferences, validateTourDirector } from '../lib/tour-director-index.mjs';

const fixture = { version: 1, tour_id: 'stories', shots: [{ id: 'pv01', title: 'opening', filename_hint: 'natural-opening', notes: { topic: 'daily_life' }, library: { recordings: [], active_recording_id: null, use_policy: { public_insert: false } } }, { id: 'pv02', title: 'self mock', filename_hint: 'funny-self-deprecation', notes: { topic: 'self_deprecation' }, library: { recordings: [], active_recording_id: null, use_policy: { public_insert: false } } }] };
const sha = 'a'.repeat(64);
const evidence = (recording_id, shotId = 'pv02', slug = 'funny-self-deprecation') => ({
  recording_id,
  title: '周末发生的趣事',
  description: '实际录音内容：讲述周末出去走路时一个有点好笑的小插曲。',
  media_path: `${shotId}-${slug}-20261026-${recording_id}.mov`,
  sha256: sha,
  duration_s: 22,
  captured_at: '2026-10-26T23:00:00Z',
  source_tour_session_id: 'session-1',
  source_media_reference: '/files/test.mov',
});

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
  const selected = selectTourReferences(next, { topics: ['self_deprecation'] })[0];
  assert.equal(selected.recording_id, 'take-2');
  assert.equal(selected.title, '周末发生的趣事');
  assert.match(selected.description, /实际录音内容/);
  assert.match(selected.media_path, /funny-self-deprecation-20261026-take-2/);
  assert.equal(selected.shot_title, 'self mock');
  const alternatives = selectTourReferences(next, { allTakes: true });
  assert.equal(alternatives.length, 2);
  assert.deepEqual(alternatives.map(x => x.is_active), [false, true]);
  assert.deepEqual(selectTourReferences(next, { publicInsert: true }), []);
});

test('rejects unsafe file references and duplicate take IDs', () => {
  assert.throws(() => appendTourRecording(fixture, 'pv02', { ...evidence('take-1'), media_path: '../secret.mov' }));
  const next = appendTourRecording(fixture, 'pv02', evidence('take-1'));
  assert.throws(() => appendTourRecording(next, 'pv02', evidence('take-1')));
  assert.throws(() => appendTourRecording(fixture, 'pv02', { ...evidence('bad-title'), title: '' }));
  assert.throws(() => appendTourRecording(fixture, 'pv02', { ...evidence('bad-description'), description: '未分析' }));
  assert.throws(() => appendTourRecording(fixture, 'pv02', { ...evidence('opaque'), media_path: 'pv02-opaque.mov' }));
});


test('accepts a flat audio-only Tour recording from either recorder without a new index', () => {
  const sound = appendTourRecording(fixture, 'pv01', {
    ...evidence('audio-1', 'pv01', 'natural-opening'), media_path: 'pv01-natural-opening-20261026-audio-1.m4a'
  });
  assert.equal(selectTourReferences(sound)[0].media_path, 'pv01-natural-opening-20261026-audio-1.m4a');
  const unsafe = { ...evidence('nested'), media_path: 'session/media/pv01-nested.mov' };
  assert.throws(() => appendTourRecording(fixture, 'pv01', unsafe));
});


test('missing take descriptions and misleading or malformed filenames invalidate an existing index', () => {
  const first = appendTourRecording(fixture, 'pv02', evidence('take-1'));
  const changed = structuredClone(first);
  changed.shots[1].library.recordings[0].description = '';
  assert.match(validateTourDirector(changed).join('; '), /missing actual recorded-media description/);
  changed.shots[1].library.recordings[0].description = '实际录音内容：讲了周末散步时发生的一件趣事。';
  changed.shots[1].library.recordings[0].media_path = 'pv02-take-1.mov';
  assert.match(validateTourDirector(changed).join('; '), /filename must describe/);
  changed.shots[1].library.recordings[0].media_path = 'pv02-daily-walk-20261026-take-1.mov';
  assert.deepEqual(validateTourDirector(changed), []);
});
