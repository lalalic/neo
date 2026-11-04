import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  localAsrSpeechBoundaries,
  localAsrToVtt,
  normalizeLocalAsr,
  parseVtt,
  scribeToVtt,
  validateSpeakerResolution,
} from '../scripts/speaker-vtt.mjs';

const project = fileURLToPath(new URL('..', import.meta.url));
const raw = {
  language: 'en',
  duration: 2.6,
  segments: [
    {start: 0, end: 1.2, text: 'Hello there.', words: [
      {word: 'Hello', start: 0, end: 0.5},
      {word: 'there,', start: 0.65, end: 1.2},
    ]},
    {start: 2, end: 2.5, text: 'Okay.', words: [
      {word: 'Okay.', start: 2, end: 2.5},
    ]},
  ],
};

test('local MLX Whisper words become explicitly unknown WebVTT and source-time boundaries', () => {
  const normalized = normalizeLocalAsr(raw);
  assert.deepEqual(normalized.words.map((word) => word.speaker_id), [
    'speaker_unknown', 'speaker_unknown', 'speaker_unknown',
  ]);
  assert.equal(normalized.audio_duration_secs, 2.6);
  const vtt = localAsrToVtt(raw);
  const cues = parseVtt(vtt);
  assert.deepEqual(cues.map((cue) => [cue.who, cue.text]), [
    ['speaker_unknown', 'Hello there,'],
    ['speaker_unknown', 'Okay.'],
  ]);
  assert.deepEqual(cues.map((cue) => [cue.start, cue.end]), [[0, 1.2], [2, 2.5]]);
  const boundaries = localAsrSpeechBoundaries(raw);
  assert.equal(boundaries.engine, 'mlx-whisper');
  assert.match(boundaries.basis, /speaker attribution is unknown/);
  assert.equal(boundaries.word_count, 3);
  assert.equal(boundaries.gaps.length, 2);
});

test('uncertain local speakers cannot be silently given story identities', () => {
  const original = localAsrToVtt(raw);
  assert.deepEqual(validateSpeakerResolution(original, original), {
    cues: 2,
    speaker_names: {speaker_unknown: 'speaker_unknown'},
  });
  assert.throws(() => validateSpeakerResolution(
    original,
    original.replace('<v speaker_unknown>', '<v Alice>'),
    {characters: [{name: 'Alice'}]},
  ), /unknown_speaker_must_remain_unknown/);
});

test('malformed local timestamps, words, or claimed diarization fail closed', () => {
  const missingEnd = structuredClone(raw);
  delete missingEnd.segments[0].words[0].end;
  assert.throws(() => normalizeLocalAsr(missingEnd), /word_0_invalid/);
  const emptySegment = structuredClone(raw);
  emptySegment.segments[0].words = [];
  assert.throws(() => normalizeLocalAsr(emptySegment), /words_required/);
  const claimedSpeaker = structuredClone(raw);
  claimedSpeaker.segments[0].words[0].speaker_id = 'speaker_1';
  assert.throws(() => normalizeLocalAsr(claimedSpeaker), /diarization_unsupported/);
  const outOfOrder = structuredClone(raw);
  outOfOrder.segments[1].words[0].start = 0.4;
  outOfOrder.segments[1].words[0].end = 0.8;
  assert.throws(() => normalizeLocalAsr(outOfOrder), /word_0_invalid/);
  const invalidSegment = structuredClone(raw);
  invalidSegment.segments[0].end = 0;
  assert.throws(() => normalizeLocalAsr(invalidSegment), /segment_0_timing_invalid/);
  assert.throws(() => normalizeLocalAsr({}), /segments_required/);
});

test('Video Use Scribe still rejects speaker_unknown labels', () => {
  assert.throws(() => scribeToVtt({words:[{
    type:'word',speaker_id:'speaker_unknown',start:0,end:0.1,text:'Unattributed',
  }]}), /scribe_word_invalid/);
});

test('CLI from-local-asr writes deterministic artifacts without altering raw local JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'neo-local-asr-'));
  try {
    const input = join(dir, 'local-asr.json');
    const output = join(dir, 'speaker-id.vtt');
    const boundaries = join(dir, 'boundaries.json');
    writeFileSync(input, JSON.stringify(raw));
    const generated = spawnSync(process.execPath, [join(project, 'scripts/speaker-vtt.mjs'),
      'from-local-asr', '--input', input, '--output', output, '--boundaries', boundaries], {encoding: 'utf8'});
    assert.equal(generated.status, 0, generated.stderr);
    assert.match(readFileSync(output, 'utf8'), /^WEBVTT\n\n00:00:00\.000 --> 00:00:01\.200\n<v speaker_unknown>Hello there,<\/v>/);
    const boundary = JSON.parse(readFileSync(boundaries, 'utf8'));
    assert.equal(boundary.engine, 'mlx-whisper');
    assert.equal(readFileSync(input, 'utf8'), JSON.stringify(raw));
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('Relay artifact validator accepts only explicitly unknown source-bound local ASR provenance', (t) => {
  const schema = join(project, 'contracts/local-asr-source.schema.json');
  const directory = mkdtempSync(join(tmpdir(), 'neo-local-asr-schema-'));
  t.after(() => rmSync(directory, {recursive: true, force: true}));
  const artifact = join(directory, 'local-asr-source.json');
  const accepted = {
    schema: 'content-distribution.local-asr-source.v1',
    source_sha256: 'a'.repeat(64),
    source_path: '/absolute/original.mp4',
    source_bytes: 100,
    source_duration_s: 1,
    transcript_sha256: 'b'.repeat(64),
    transcript_bytes: 200,
    transcript_path: '/absolute/local-asr.json',
    word_count: 179,
    word_timestamps: true,
    transcription_engine: 'mlx-whisper',
    model_id: 'mlx-community/whisper-large-v3-turbo',
    model_version: '0123456789abcdef0123456789abcdef01234567',
    speaker_attribution: 'unknown',
    observed_at: '2026-11-03T10:00:00Z',
  };
  const validate = (value, valid) => {
    writeFileSync(artifact, JSON.stringify(value));
    const result = spawnSync('npx', ['agents-relay', 'artifact', 'validate',
      '--artifact', artifact, '--schema', schema], {cwd: project, encoding: 'utf8', timeout: 15000});
    assert.equal(result.status, valid ? 0 : 1, valid ? result.stderr : result.stdout);
    return JSON.parse(result.stdout);
  };
  assert.equal(validate(accepted, true).valid, true);
  assert.equal(validate({...accepted, transcription_engine: 'video-use-scribe'}, false).valid, false);
  assert.equal(validate({...accepted, speaker_attribution: 'speaker_1'}, false).valid, false);
});
