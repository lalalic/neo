import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { scribeToVtt, parseVtt, speechBoundaryEvidence, validateSpeakerResolution } from '../scripts/speaker-vtt.mjs';

const words = [
  { type:'audio_event', start:0, end:2, text:'[upbeat music]', speaker_id:'speaker_0' },
  { type:'word', start:1, end:1.2, text:'Sorry,', speaker_id:'speaker_0' },
  { type:'spacing', start:1.2, end:1.4, text:' ' },
  { type:'word', start:1.4, end:1.8, text:'wait.', speaker_id:'speaker_0' },
  { type:'word', start:2, end:2.16, text:'Oh,', speaker_id:'speaker_1' },
  { type:'word', start:2.18, end:2.18, text:'I', speaker_id:'speaker_1' },
  { type:'word', start:2.19, end:2.44, text:'see.', speaker_id:'speaker_1' },
  { type:'word', start:3.1, end:3.3, text:'Again.', speaker_id:'speaker_0' },
];

const story = { characters: [{ name:'Grayson Rodgers', aliases:['Grayson'] }, { name:'Bianca' }] };
const original = scribeToVtt({words});
const renamed = original.replaceAll('<v speaker_0>', '<v Bianca>').replaceAll('<v speaker_1>', '<v Grayson Rodgers>');

test('Video Use Scribe words produce deterministic speaker-ID WebVTT, not EDL or audio-event speech', () => {
  assert.match(original, /^WEBVTT\n\n/);
  const cues = parseVtt(original);
  assert.deepEqual(cues.map(c => c.who), ['speaker_0', 'speaker_1', 'speaker_0']);
  assert.deepEqual(cues.map(c => c.text), ['Sorry, wait.', 'Oh, I see.', 'Again.']);
  assert.deepEqual(cues.map(c => [c.start, c.end]), [[1,1.8],[2,2.44],[3.1,3.3]]);
  assert.ok(!original.includes('upbeat music'));
  assert.ok(!original.includes('edl'));
  const boundaries = speechBoundaryEvidence({words});
  assert.equal(boundaries.word_count, 6);
  assert.equal(boundaries.gaps.length, 3);
  assert.equal(boundaries.gaps[2].kind, 'speech_gap_candidate');
});

test('agent may guess character names while retaining every dialogue cue and timestamp', () => {
  assert.deepEqual(validateSpeakerResolution(original, renamed, story), {
    cues:3, speaker_names:{speaker_0:'Bianca', speaker_1:'Grayson Rodgers'},
  });
  assert.deepEqual(validateSpeakerResolution(original, original, story), {
    cues:3, speaker_names:{speaker_0:'speaker_0', speaker_1:'speaker_1'},
  });
});

test('validation holds tampered speech, timing, added cues, invented names and inconsistent speaker labels', () => {
  assert.throws(() => validateSpeakerResolution(original, renamed.replace('wait.', 'stop.'), story), /dialogue_changed/);
  assert.throws(() => validateSpeakerResolution(original, renamed.replace('00:00:01.800','00:00:01.900'), story), /timing_or_dialogue_changed/);
  assert.throws(() => validateSpeakerResolution(original, renamed + '\n00:00:04.000 --> 00:00:04.500\n<v Bianca>Fake</v>\n', story), /cue_count_changed/);
  assert.throws(() => validateSpeakerResolution(original, renamed.replaceAll('Bianca','Invented'), story), /name_not_in_story_context/);
  assert.throws(() => validateSpeakerResolution(original, renamed.replace('<v Bianca>Again.', '<v Grayson>Again.'), story), /mapping_inconsistent/);
  assert.throws(() => validateSpeakerResolution(original, '<bad>', story), /webvtt_header_required/);
});

test('CLI from-scribe → agent VTT → validate runs without changing the raw STT result', () => {
  const dir = mkdtempSync(join(tmpdir(), 'neo-speaker-vtt-'));
  try {
    const raw=join(dir,'scribe.json'), source=join(dir,'speaker-id.vtt'), out=join(dir,'speaker-name.vtt'), ctx=join(dir,'story.json'), boundaries=join(dir,'boundaries.json');
    writeFileSync(raw, JSON.stringify({words}));
    writeFileSync(ctx, JSON.stringify(story));
    const run=(...args)=>spawnSync(process.execPath,[new URL('../scripts/speaker-vtt.mjs',import.meta.url).pathname,...args],{encoding:'utf8'});
    const generated=run('from-scribe','--input',raw,'--output',source,'--boundaries',boundaries);
    assert.equal(generated.status,0,generated.stderr);
    assert.equal(readFileSync(source,'utf8'),original);
    assert.equal(JSON.parse(readFileSync(boundaries)).gaps.length,3);
    writeFileSync(out,renamed);
    const checked=run('validate','--source',source,'--resolved',out,'--story-context',ctx);
    assert.equal(checked.status,0,checked.stderr);
    assert.equal(JSON.parse(checked.stdout).cues,3);
    assert.equal(JSON.parse(readFileSync(raw)).words.length,words.length);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test('malformed Scribe input is rejected without issuing cloud calls', () => {
  assert.throws(() => scribeToVtt({words:[{type:'word',start:1,end:2,text:'No ID'}]}),/scribe_word_invalid/);
  assert.throws(() => scribeToVtt({words:[{type:'word',start:4,end:2,text:'Bad',speaker_id:'speaker_0'}]}),/scribe_word_invalid/);
  assert.throws(() => scribeToVtt({}),/scribe_words_required/);
});
