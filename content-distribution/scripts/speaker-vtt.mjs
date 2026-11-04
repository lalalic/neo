#!/usr/bin/env node
// Deterministic WebVTT bridge around Video Use Scribe. Character inference belongs to the Agent.
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const speakerId = /^speaker_\d+$/;
const unknownSpeaker = 'speaker_unknown';
const recognizedSpeaker = (value) => speakerId.test(value) || value === unknownSpeaker;
const timing = /^(\d{2}):(\d{2}):(\d{2})\.(\d{3}) --> (\d{2}):(\d{2}):(\d{2})\.(\d{3})$/;
const voice = /^<v ([^<>\r\n]+)>([^\r\n]*)<\/v>$/;

function seconds(parts) {
  const [, h, m, s, ms] = parts;
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
}

function formatTime(seconds) {
  const ms = Math.round(seconds * 1000);
  return [Math.floor(ms / 3600000), Math.floor(ms / 60000) % 60, Math.floor(ms / 1000) % 60]
    .map((part) => String(part).padStart(2, '0')).join(':') + '.' + String(ms % 1000).padStart(3, '0');
}

export function scribeToVtt(doc, {allowUnknownSpeaker = false} = {}) {
  if (!Array.isArray(doc?.words)) throw new Error('scribe_words_required');
  const words = doc.words.filter((item) => item.type === 'word');
  const cues = [];
  let group = [];
  const flush = () => {
    if (!group.length) return;
    const start = group[0].start;
    const end = group[group.length - 1].end;
    const who = group[0].speaker_id;
    const text = group.map((item) => item.text.trim()).join(' ').replace(/\s+([,.!?;:])/g, '$1');
    if (/[<>\r\n]/.test(text)) throw new Error('scribe_text_invalid_for_vtt');
    cues.push({start, end, who, text});
    group = [];
  };
  for (const item of words) {
    if (!Number.isFinite(item.start) || !Number.isFinite(item.end) || item.end < item.start ||
        !(speakerId.test(item.speaker_id || '') || (allowUnknownSpeaker && item.speaker_id === unknownSpeaker)) ||
        typeof item.text !== 'string' || !item.text.trim()) {
      throw new Error('scribe_word_invalid');
    }
    if (group.length && (item.speaker_id !== group[0].speaker_id ||
        item.start - group[group.length - 1].end >= 0.5)) flush();
    group.push(item);
  }
  flush();
  return 'WEBVTT\n\n' + cues.map((cue) =>
    `${formatTime(cue.start)} --> ${formatTime(cue.end)}\n<v ${cue.who}>${cue.text}</v>`
  ).join('\n\n') + '\n';
}

export function normalizeLocalAsr(doc) {
  if (!Array.isArray(doc?.segments)) throw new Error('local_asr_segments_required');
  if (doc.duration != null && (!Number.isFinite(doc.duration) || doc.duration <= 0)) {
    throw new Error('local_asr_duration_invalid');
  }
  const words = [];
  let previousStart = -Infinity;
  for (const [segmentIndex, segment] of doc.segments.entries()) {
    if (!Number.isFinite(segment?.start) || !Number.isFinite(segment?.end) ||
        segment.start < 0 || segment.end <= segment.start ||
        (doc.duration != null && segment.end > doc.duration + 0.05)) {
      throw new Error(`local_asr_segment_${segmentIndex}_timing_invalid`);
    }
    if (!Array.isArray(segment.words) || !segment.words.length) {
      throw new Error(`local_asr_segment_${segmentIndex}_words_required`);
    }
    for (const [wordIndex, item] of segment.words.entries()) {
      if (!item || typeof item !== 'object' || Array.isArray(item) ||
          !Number.isFinite(item.start) || !Number.isFinite(item.end) ||
          item.start < 0 || item.end <= item.start || item.start < previousStart ||
          (doc.duration != null && item.end > doc.duration + 0.05) ||
          typeof item.word !== 'string' || !item.word.trim()) {
        throw new Error(`local_asr_segment_${segmentIndex}_word_${wordIndex}_invalid`);
      }
      if (item.speaker_id != null) throw new Error('local_asr_diarization_unsupported');
      previousStart = item.start;
      words.push({
        type: 'word',
        speaker_id: unknownSpeaker,
        start: item.start,
        end: item.end,
        text: item.word,
      });
    }
  }
  if (!words.length) throw new Error('local_asr_words_required');
  return {audio_duration_secs: Number.isFinite(doc.duration) ? doc.duration : null, words};
}

export function localAsrToVtt(doc) {
  return scribeToVtt(normalizeLocalAsr(doc), {allowUnknownSpeaker: true});
}

export function speechBoundaryEvidence(doc) {
  if (!Array.isArray(doc?.words)) throw new Error('scribe_words_required');
  const words = doc.words.filter((item) => item.type === 'word');
  const gaps = [];
  for (let i = 1; i < words.length; i++) {
    const prev = words[i - 1], next = words[i];
    if (!Number.isFinite(prev.end) || !Number.isFinite(next.start) || next.start < prev.start) {
      throw new Error('scribe_words_out_of_order');
    }
    const gap = next.start - prev.end;
    if (gap >= 0.15) gaps.push({
      start_s: prev.end,
      end_s: next.start,
      speaker_change: prev.speaker_id !== next.speaker_id,
      kind: 'speech_gap_candidate',
    });
  }
  return {
    kind: 'speech_boundary_evidence',
    basis: 'Scribe word timestamps; candidate gaps are not proven silent or visually safe',
    word_count: words.length,
    duration_s: doc.audio_duration_secs ?? null,
    gaps,
  };
}

export function localAsrSpeechBoundaries(doc) {
  const normalized = normalizeLocalAsr(doc);
  const evidence = speechBoundaryEvidence(normalized);
  return {
    ...evidence,
    engine: 'mlx-whisper',
    basis: 'MLX Whisper word timestamps; candidate gaps are not proven silent or visually safe; speaker attribution is unknown',
  };
}

export function parseVtt(text) {
  const blocks = text.replace(/\r\n/g, '\n').trimEnd().split(/\n\n+/);
  if (blocks.shift() !== 'WEBVTT') throw new Error('webvtt_header_required');
  if (!blocks.length) throw new Error('webvtt_cues_required');
  return blocks.map((block, index) => {
    const lines = block.split('\n');
    if (lines.length !== 2) throw new Error(`cue_${index}_shape_invalid`);
    const match = lines[0].match(timing);
    const body = lines[1].match(voice);
    if (!match || !body) throw new Error(`cue_${index}_invalid`);
    const start = seconds(match.slice(0, 5));
    const end = seconds([null, ...match.slice(5, 9)]);
    if (end <= start || !body[2].trim()) throw new Error(`cue_${index}_timing_or_text_invalid`);
    return {time: lines[0], start, end, who: body[1], text: body[2]};
  });
}

export function validateSpeakerResolution(original, resolved, story = null) {
  const source = parseVtt(original);
  const result = parseVtt(resolved);
  if (source.length !== result.length) throw new Error('cue_count_changed');
  const characters = new Set((story?.characters ?? []).flatMap((character) =>
    [character.name, ...(character.aliases ?? [])]));
  const mapping = new Map();
  for (const [index, cue] of source.entries()) {
    const next = result[index];
    if (!recognizedSpeaker(cue.who)) throw new Error(`source_cue_${index}_not_speaker_id`);
    if (cue.time !== next.time || cue.text !== next.text) throw new Error(`cue_${index}_timing_or_dialogue_changed`);
    if (cue.who === unknownSpeaker && next.who !== unknownSpeaker) {
      throw new Error('unknown_speaker_must_remain_unknown');
    }
    if (next.who !== cue.who && story && !characters.has(next.who)) {
      throw new Error(`cue_${index}_name_not_in_story_context`);
    }
    if (mapping.has(cue.who) && mapping.get(cue.who) !== next.who) {
      throw new Error(`speaker_${cue.who}_mapping_inconsistent`);
    }
    mapping.set(cue.who, next.who);
  }
  return {cues: source.length, speaker_names: Object.fromEntries(mapping)};
}

function option(args, name) {
  const index = args.indexOf(name);
  return index < 0 ? null : args[index + 1];
}

function main(args) {
  const [mode, ...flags] = args;
  if (mode === 'from-scribe' || mode === 'from-local-asr') {
    const input = option(flags, '--input');
    const output = option(flags, '--output');
    if (!input || !output || resolve(input) === resolve(output)) throw new Error(`usage: ${mode} --input INPUT.json --output speaker-id.vtt [--boundaries boundaries.json] [--exclusive]`);
    const doc = JSON.parse(readFileSync(resolve(input), 'utf8'));
    const toVtt = mode === 'from-scribe' ? scribeToVtt : localAsrToVtt;
    const toBoundaries = mode === 'from-scribe' ? speechBoundaryEvidence : localAsrSpeechBoundaries;
    const vtt = toVtt(doc);
    mkdirSync(dirname(resolve(output)), {recursive: true});
    const exclusive = flags.includes('--exclusive');
    const boundaries = option(flags, '--boundaries');
    if (exclusive && boundaries && existsSync(resolve(boundaries))) throw new Error('scribe_boundaries_output_exists');
    writeFileSync(resolve(output), vtt, exclusive ? {flag:'wx'} : undefined);
    if (boundaries) {
      mkdirSync(dirname(resolve(boundaries)), {recursive: true});
      writeFileSync(resolve(boundaries), JSON.stringify(toBoundaries(doc), null, 2) + '\n',
        exclusive ? {flag:'wx'} : undefined);
    }
    console.log(JSON.stringify({output: resolve(output), cues: parseVtt(vtt).length, boundaries: boundaries ? resolve(boundaries) : null}));
  } else if (mode === 'validate') {
    const source = option(flags, '--source');
    const resolved = option(flags, '--resolved');
    const storyFile = option(flags, '--story-context');
    if (!source || !resolved || resolve(source) === resolve(resolved)) throw new Error('usage: validate --source speaker-id.vtt --resolved speaker-name.vtt [--story-context story.json]');
    const story = storyFile ? JSON.parse(readFileSync(resolve(storyFile), 'utf8')) : null;
    console.log(JSON.stringify(validateSpeakerResolution(readFileSync(resolve(source), 'utf8'), readFileSync(resolve(resolved), 'utf8'), story)));
  } else {
    throw new Error('usage: node scripts/speaker-vtt.mjs {from-scribe|from-local-asr|validate} [options]');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(resolve(process.argv[1]))).href) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(`HOLD: ${error.message}`); process.exitCode = 1; }
}
