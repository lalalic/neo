import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { renderInitialCutPreview, visionContextFromProposal } from '../lib/initial-cut-preview.mjs';
import {
  parseWebVtt, detectHeyNeoCommands, buildInitialCutProposal,
} from '../lib/initial-cut-proposal.mjs';

const text = `WEBVTT

00:00.000 --> 00:00.940
Thank you.

00:01.000 --> 00:01.300
嘿 Neo

00:01.310 --> 00:02.100
这段原声保留

00:03.000 --> 00:03.500
Hey Neo, 这一段剪掉

00:05.000 --> 00:05.500
嘿 Neo 做得好
`;

test('parse timestamped WebVTT, ignore header and malformed cues', () => {
  const cues = parseWebVtt(text);
  assert.equal(cues.length, 5);
  assert.deepEqual(cues[0], { start_seconds: 0, end_seconds: 0.94, text: 'Thank you.' });
  assert.deepEqual(parseWebVtt('WEBVTT\n\n00:02.000 --> 00:01.000\noops'), []);
});

test('Hey Neo next-cue command is an instruction with audio interval; unsupported is ambiguous', () => {
  const cmds = detectHeyNeoCommands(parseWebVtt(text), 'V1');
  assert.equal(cmds.length, 3);
  assert.equal(cmds[0].utterance, '这段原声保留');
  assert.equal(cmds[0].action, 'preserve_original_audio');
  assert.deepEqual([cmds[0].start_seconds, cmds[0].end_seconds], [1, 2.1]);
  assert.equal(cmds[1].action, 'remove');
  assert.equal(cmds[2].ambiguous, true);
  assert.equal(cmds[0].exclude_command_audio_from_story, true);
});

test('custom wake phrases work without globally changing the default', () => {
  const cue = [{ start_seconds: 4, end_seconds: 5, text: '小助手，保留这个镜头' }];
  assert.equal(detectHeyNeoCommands(cue, 'V1').length, 0);
  assert.equal(detectHeyNeoCommands(cue, 'V1', { wakePhrases: ['小助手'] })[0].action, 'keep');
});

function fixture({ approve = true, subtitle = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'vlog-initial-cut-test-'));
  const video = Buffer.from('representative clip bytes');
  const image = Buffer.from('representative image bytes');
  const sources = [
    { id: 'IMG1', path: 'IMG1.JPG', bytes: image, time: '2026-10-01T14:01:00Z' },
    { id: 'CLIP1', path: 'CLIP1.mp4', bytes: video, time: '2026-10-01T14:02:00Z' },
  ];
  const media = sources.map(({ id, path, bytes, time }) => {
    const original_path = join(dir, path);
    writeFileSync(original_path, bytes);
    return {
      id, path, original_path, capture_time: time,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      usable_time_range_seconds: id === 'CLIP1' ? [0, 6] : null,
    };
  });
  if (subtitle) writeFileSync(join(dir, 'CLIP1.vtt'), text);
  return {
    dir,
    manifest: {
      source_use: { approved: approve, scope: 'private test' },
      canonical_source_directory: dir, media,
    },
    metadata: {
      IMG1: { perception: { desc: 'A paved path under green trees.' } },
      CLIP1: { duration: 6, perception: {
        desc: 'A handheld view of a stream with flowing water.',
        subtitle: subtitle ? 'CLIP1.vtt' : null,
        segments: {
          '0to3000': { vision: 'rocky stream' },
          '3000to6000': { vision: 'stream and bushes' },
        },
      } },
    },
  };
}

test('proposal binds source hashes, visual ranges, speech and edit intentions without approving them', t => {
  const f = fixture();
  t.after(() => rmSync(f.dir, { recursive: true, force: true }));
  const proposal = buildInitialCutProposal({ manifest: f.manifest, metadata: f.metadata, metadataDir: f.dir, context: 'Riding Vlog' });
  assert.equal(proposal.status, 'DRAFT_DIRECTOR_EDITOR_REVIEW_REQUIRED');
  assert.equal(proposal.context, 'Riding Vlog');
  assert.deepEqual(proposal.proposed_edl.edits.map(x => x.source_id), ['CLIP1', 'IMG1']);
  assert.deepEqual(proposal.proposed_edl.edits.map(x => x.beat), ['hook', 'payoff']);
  assert.deepEqual(proposal.proposed_edl.edits[0].in_seconds, 0);
  assert.deepEqual(proposal.proposed_edl.edits[0].out_seconds, 5);
  assert.equal(proposal.proposed_edl.edits[0].decision_status, 'proposed_unapproved');
  assert.equal(proposal.shot_candidates[1].observed_visual_ranges.length, 2);
  assert.deepEqual(proposal.shot_candidates[1].speech_command_audio_exclusions.map(x => x.start_seconds), [1, 3]);
  assert.equal(proposal.hey_neo_commands[0].action, 'preserve_original_audio');
  assert.equal(proposal.hey_neo_commands[1].action, 'remove');
  assert.ok(proposal.unresolved.some(x => x.includes('Editor')));
  assert.equal(proposal.shot_candidates[0].visual_description, 'A paved path under green trees.');
});

test('never claim no voice commands when STT is missing', t => {
  const f = fixture({ subtitle: false });
  t.after(() => rmSync(f.dir, { recursive: true, force: true }));
  const proposal = buildInitialCutProposal({ manifest: f.manifest, metadata: f.metadata, metadataDir: f.dir });
  assert.equal(proposal.hey_neo_commands.length, 0);
  assert.ok(proposal.unresolved.some(x => x.includes('No STT subtitle')));
});

test('refuse unapproved source, tampered bytes, and missing perception', t => {
  const f = fixture({ approve: false });
  t.after(() => rmSync(f.dir, { recursive: true, force: true }));
  const args = { manifest: f.manifest, metadata: f.metadata, metadataDir: f.dir };
  assert.throws(() => buildInitialCutProposal(args), /approval/);
  f.manifest.source_use.approved = true;
  writeFileSync(f.manifest.media[0].original_path, 'tampered');
  assert.throws(() => buildInitialCutProposal(args), /hash mismatch/);
  writeFileSync(f.manifest.media[0].original_path, Buffer.from('representative image bytes'));
  f.metadata.IMG1.perception.desc = '';
  const proposal = buildInitialCutProposal(args);
  assert.ok(proposal.unresolved.some(x => x.includes('Visual understanding pending for IMG1')));
});

test('CLI writes only draft proposal in canonical dated private run', t => {
  const root = mkdtempSync(join(tmpdir(), 'vlog-cli-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, 'vlog', 'runs', '2026-10-01-test');
  mkdirSync(dir, { recursive: true });
  const f = fixture();
  t.after(() => rmSync(f.dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'source-manifest.json'), JSON.stringify({ ...f.manifest, markcut_metadata_path: join(dir, 'metadata.json') }));
  writeFileSync(join(dir, 'metadata.json'), JSON.stringify(f.metadata));
  writeFileSync(join(dir, 'CLIP1.vtt'), text);
  const result = JSON.parse(execFileSync('node', [join(import.meta.dirname, '../scripts/propose-initial-cut.mjs'), dir], { encoding: 'utf8' }));
  assert.equal(result.shots, 2);
  assert.equal(result.hey_neo_commands, 3);
  const proposal = JSON.parse(readFileSync(join(dir, 'initial-cut-proposal.json'), 'utf8'));
  assert.equal(proposal.proposed_edl.edits[0].beat, 'hook');
});

test('vision preprocess works with no prior image/video perception and emits second-pass context', t => {
  const f = fixture();
  t.after(() => rmSync(f.dir, { recursive: true, force: true }));
  const proposal = buildInitialCutProposal({
    manifest: f.manifest, metadata: {}, metadataDir: f.dir,
    context: 'bike ride by stream',
  });
  assert.equal(proposal.status, 'DRAFT_DIRECTOR_EDITOR_REVIEW_REQUIRED');
  assert.equal(proposal.hey_neo_commands.length, 3);
  assert.deepEqual(proposal.vision_handoff.unresolved_visuals, ['IMG1', 'CLIP1']);
  assert.equal(proposal.proposed_edl.edits[0].source_id, 'CLIP1');
  const context = JSON.parse(visionContextFromProposal(proposal));
  assert.equal(context.stage, 'post_initial_cut_vision_understanding');
  assert.equal(context.rough_cut_order.length, 2);
  assert.equal(context.hey_neo_constraints[0].action, 'preserve_original_audio');
});

test('playable initial-cut proxy has video/audio and a matching original time range', t => {
  const dir = mkdtempSync(join(tmpdir(), 'vlog-roughcut-proxy-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const input = join(dir, 'clip.mp4');
  const output = join(dir, 'initial.mp4');
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
    '-i', 'testsrc=size=160x90:rate=24:duration=2', '-f','lavfi',
    '-i','sine=frequency=880:sample_rate=44100:duration=2',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p','-c:a','aac','-shortest',input]);
  const draft = {
    status: 'DRAFT_DIRECTOR_EDITOR_REVIEW_REQUIRED',
    proposed_edl: { edits: [{
      source_id: 'clip', source_path: input, in_seconds: 0.2, out_seconds: 1.8,
      speech_command_audio_exclusions: [{ start_seconds: 0.5, end_seconds: 1.0 }],
    }] },
  };
  const outcome = renderInitialCutPreview(draft, output);
  assert.equal(outcome.preview_only, true);
  const info = JSON.parse(execFileSync('ffprobe', ['-v', 'error','-show_entries',
    'stream=codec_name,width,height:format=duration','-of','json',output], { encoding:'utf8' }));
  assert.deepEqual(info.streams.map(s=>s.codec_name), ['h264','aac']);
  assert.deepEqual([info.streams[0].width, info.streams[0].height], [540,960]);
  assert.ok(Math.abs(Number(info.format.duration) - 1.6) < 0.1);
  const loudnessAt = seconds => {
    const samples = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(seconds),
      '-i', output, '-t', '0.1', '-vn', '-ac', '1', '-ar', '44100', '-f', 's16le', 'pipe:1']);
    let sum = 0;
    for (let i = 0; i < samples.length - 1; i += 2) sum += Math.abs(samples.readInt16LE(i));
    return sum / (samples.length / 2);
  };
  assert.ok(loudnessAt(0.1) > 500, 'meaningful source audio is preserved');
  assert.ok(loudnessAt(0.5) < 60, 'Hey Neo command interval is muted in rough proxy');
});

test('only exact verified Hey Neo source deletion changes rough-cut order', t => {
  const f = fixture();
  t.after(() => rmSync(f.dir, { recursive: true, force: true }));
  writeFileSync(join(f.dir, 'CLIP1.vtt'),
    'WEBVTT\n\n00:01.000 --> 00:02.000\nHey Neo 删除 IMG1\n');
  const proposal = buildInitialCutProposal({ manifest: f.manifest, metadata: {}, metadataDir: f.dir });
  assert.deepEqual(proposal.proposed_edl.edits.map(x => x.source_id), ['CLIP1']);
  assert.equal(proposal.hey_neo_commands[0].target_source_id, 'IMG1');
  assert.equal(proposal.hey_neo_commands[0].applied_in_rough_cut, true);
  assert.equal(JSON.parse(visionContextFromProposal(proposal)).hey_neo_constraints[0].applied_in_rough_cut, true);
  writeFileSync(join(f.dir, 'CLIP1.vtt'),
    'WEBVTT\n\n00:01.000 --> 00:02.000\nHey Neo 删除这段\n');
  const ambiguousTarget = buildInitialCutProposal({ manifest: f.manifest, metadata: {}, metadataDir: f.dir });
  assert.equal(ambiguousTarget.proposed_edl.edits.length, 2);
  assert.ok(ambiguousTarget.unresolved.some(x => x.includes('no exact target')));
});
