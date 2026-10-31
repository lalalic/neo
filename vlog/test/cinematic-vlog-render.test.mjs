import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { compileCinematicVlog, lintCinematicVlog } from '../lib/cinematic-vlog.mjs';

const run = (...args) => execFileSync(args[0], args.slice(1), { stdio: 'pipe', maxBuffer: 64 * 1024 * 1024 });

test('cinematic preset renders three source shots with no black boundary spans and continuous audio', { timeout: 180_000 }, () => {
  const cwd = process.cwd();
  const day = new Date().toISOString().slice(0, 10);
  mkdirSync('runs', { recursive: true });
  const dir = process.env.VLOG_CINEMATIC_EVIDENCE_DIR
    ? resolve(process.env.VLOG_CINEMATIC_EVIDENCE_DIR)
    : mkdtempSync(join(cwd, 'runs', `${day}-cinematic-continuity-test-`));
  mkdirSync(dir, { recursive: true });
  try {
    process.chdir(dir);
    const scenes = [
      { id: 'hook', beat: 'hook', type: 'video', path: 'assets/hook.mp4', duration: 1.5, authorized: true, sourceHash: 'synthetic-hook', evidenceRef: 'synthetic test source 1' },
      { id: 'development', beat: 'development', type: 'image', path: 'assets/development.png', duration: 0.5, audioPath: 'assets/voice.m4a', audioDuration: 1.5, authorized: true, sourceHash: 'synthetic-development', evidenceRef: 'synthetic test source 2', override: { motion: 'slowPush', description: 'extend the still under the full audio beat', rationale: 'the visual is intentionally shorter than the sound bed', evidenceRef: 'synthetic test timeline' } },
      { id: 'payoff', beat: 'payoff', type: 'video', path: 'assets/payoff.mp4', duration: 2.5, authorized: true, sourceHash: 'synthetic-payoff', evidenceRef: 'synthetic test source 3' }
    ];
    mkdirSync('assets', { recursive: true });
    for (const [index, color] of ['red', 'green', 'blue'].entries()) {
      if (scenes[index].type === 'image') run('ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${color}:s=160x284`, '-frames:v', '1', `assets/${scenes[index].id}.png`);
      else run('ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${color}:s=160x284:r=10:d=${scenes[index].duration}`, '-f', 'lavfi', '-i', `sine=frequency=${440 + index * 80}:sample_rate=48000:duration=${scenes[index].duration}`, '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', `assets/${scenes[index].id}.mp4`);
      scenes[index].sourceHash = createHash('sha256').update(readFileSync(scenes[index].path)).digest('hex');
    }
    run('ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=640:sample_rate=48000:duration=1.5', '-c:a', 'aac', 'assets/voice.m4a');
    run('ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000:duration=8', '-c:a', 'aac', 'assets/music.m4a');
    const music = { path: 'assets/music.m4a', authorized: true, sha256: createHash('sha256').update(readFileSync('assets/music.m4a')).digest('hex'), evidenceRef: 'synthetic test sound authorization' };
    writeFileSync('assets/captions.vtt', 'WEBVTT\n\n00:00:00.100 --> 00:00:01.000\n<span style="background:rgba(0,0,0,.68);padding:10px 18px;border-radius:8px">A real source-grounded hook</span>\n');
    const boundaries = [{ transition: 'fade', seconds: 0.3, rationale: 'soften the scene change' }, { transition: 'fade', seconds: 0.3, rationale: 'carry into the payoff' }];
    const captions = { path: 'assets/captions.vtt' };
    const episode = { scenes, boundaries, music, captions, width: 160, height: 284, fps: 10 };
    writeFileSync('episode-input.json', JSON.stringify(episode));
    run(process.execPath, resolve(cwd, 'scripts/compile-cinematic-vlog.mjs'), 'episode-input.json', 'video.md');
    const markdown = readFileSync('video.md', 'utf8');
    assert.match(markdown, /image src:assets\/development\.png duration:1\.5 fit:cover isBackground:true/);
    assert.match(markdown, /scale\(1\.02\)/);
    assert.match(markdown, /synthetic test timeline/);
    assert.deepEqual(lintCinematicVlog(markdown, { scenes, boundaries, music, captions }), []);
    run('markcut', 'verify', 'video.md');
    run('markcut', 'render', 'video.md', '--output', 'output.mp4');

    const info = JSON.parse(run('ffprobe', '-v', 'error', '-show_entries', 'stream=codec_type,duration:format=duration', '-of', 'json', 'output.mp4'));
    assert.ok(info.streams.some(s => s.codec_type === 'video'));
    assert.ok(info.streams.some(s => s.codec_type === 'audio'), 'rendered BGM/audio stream is absent');

    // Decode every encoded frame, not sparse still samples, and measure luma.
    const raw = run('ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', 'output.mp4', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-');
    const frameBytes = 160 * 284 * 3;
    assert.equal(raw.length % frameBytes, 0, 'full output did not decode to complete frames');
    const means = [];
    for (let offset = 0; offset < raw.length; offset += frameBytes) {
      let sum = 0;
      for (let i = offset; i < offset + frameBytes; i += 3) sum += (0.2126 * raw[i] + 0.7152 * raw[i + 1] + 0.0722 * raw[i + 2]);
      means.push(sum / (frameBytes / 3));
    }
    assert.ok(means.length >= 48, `expected full 4.9s encoded output, got ${means.length} frames`);
    assert.ok(means.every(m => m > 8), `found black frame(s): ${means.map((m, i) => m <= 8 ? `${i}:${m.toFixed(1)}` : null).filter(Boolean).join(', ')}`);
    // TransitionSeries starts the next scene before the prior scene duration ends.
    for (const boundary of [1.2, 2.4]) {
      const frame = Math.round(boundary * 10);
      assert.ok(means.slice(frame - 3, frame + 4).every(m => m > 8), `black gap at ${boundary}s boundary`);
    }

    // Decode audio to PCM and check short windows around both cuts for actual sound.
    const pcm = run('ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', 'output.mp4', '-map', '0:a:0', '-f', 's16le', '-ac', '1', '-ar', '48000', '-');
    const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 2));
    let minimumWindowRms = Infinity;
    for (let start = 0; start + 2400 <= samples.length; start += 2400) {
      let energy = 0;
      for (let i = start; i < start + 2400; i++) energy += samples[i] * samples[i];
      minimumWindowRms = Math.min(minimumWindowRms, Math.sqrt(energy / 2400));
    }
    assert.ok(minimumWindowRms > 150, `render has a silent 50ms audio window (min RMS ${minimumWindowRms})`);
    for (const boundary of [1.2, 2.4]) {
      const start = Math.floor((boundary - 0.15) * 48000);
      const end = Math.floor((boundary + 0.15) * 48000);
      let energy = 0;
      for (let i = start; i < end; i++) energy += samples[i] * samples[i];
      assert.ok(Math.sqrt(energy / (end - start)) > 150, `audio is silent near ${boundary}s boundary`);
    }
    assert.ok(pcm.length > 48_000 * 2 * 3, 'decoded audio is not continuous across the full render');

    const cuts = boundaries.map(() => ({ transition: 'cut', rationale: 'the action and source sound carry directly across this beat' }));
    writeFileSync('cuts-input.json', JSON.stringify({ ...episode, boundaries: cuts, variant: 'cinematic-vlog-v1-cuts' }));
    run(process.execPath, resolve(cwd, 'scripts/compile-cinematic-vlog.mjs'), 'cuts-input.json', 'cuts.md');
    assert.match(readFileSync('cuts.md', 'utf8'), /layout:series\n/);
    run('markcut', 'verify', 'cuts.md');
    run('markcut', 'render', 'cuts.md', '--output', 'cuts.mp4');
    const cutRaw = run('ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', 'cuts.mp4', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-');
    assert.equal(cutRaw.length % frameBytes, 0, 'hard-cut render did not decode across its full frame span');
    const cutMeans = [];
    for (let offset = 0; offset < cutRaw.length; offset += frameBytes) {
      let sum = 0;
      for (let i = offset; i < offset + frameBytes; i += 3) sum += .2126 * cutRaw[i] + .7152 * cutRaw[i + 1] + .0722 * cutRaw[i + 2];
      cutMeans.push(sum / (frameBytes / 3));
    }
    assert.ok(cutMeans.every(m => m > 8), 'hard-cut render contains black frames');
    for (const boundary of [1.5, 3]) assert.ok(cutMeans.slice(boundary * 10 - 2, boundary * 10 + 3).every(m => m > 8), `hard-cut frames failed near ${boundary}s`);
    const cutPcm = run('ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', 'cuts.mp4', '-map', '0:a:0', '-f', 's16le', '-ac', '1', '-ar', '48000', '-');
    const cutSamples = new Int16Array(cutPcm.buffer, cutPcm.byteOffset, Math.floor(cutPcm.length / 2));
    for (const boundary of [1.5, 3]) {
      const start = Math.floor((boundary - .15) * 48000), end = Math.floor((boundary + .15) * 48000);
      let energy = 0;
      for (let i = start; i < end; i++) energy += cutSamples[i] * cutSamples[i];
      assert.ok(Math.sqrt(energy / (end - start)) > 150, `hard-cut audio is silent near ${boundary}s`);
    }

    if (process.env.VLOG_CINEMATIC_EVIDENCE_DIR) {
      writeFileSync(join(dir, 'verification.json'), JSON.stringify({
        fixture: 'synthetic three-source render',
        transition_series: { transition: 'fade', transition_seconds: .3, frames_decoded: means.length, black_frames: means.filter(m => m <= 8).length, minimum_mean_luma: Math.min(...means), boundaries_seconds: [1.2, 2.4] },
        hard_cuts: { frames_decoded: cutMeans.length, black_frames: cutMeans.filter(m => m <= 8).length, minimum_mean_luma: Math.min(...cutMeans), boundaries_seconds: [1.5, 3] },
        audio: { decoded_pcm_samples: samples.length, sample_rate: 48000, continuous_window_seconds: .05, minimum_window_rms: minimumWindowRms, window_rms_threshold: 150, cut_render_pcm_samples: cutSamples.length }
      }, null, 2));
    }
  } finally {
    process.chdir(cwd);
    if (!process.env.VLOG_CINEMATIC_EVIDENCE_DIR && !process.env.VLOG_KEEP_CINEMATIC_TEMP) rmSync(dir, { recursive: true, force: true });
  }
});

test('compiler rejects missing boundary choices and unauthorized BGM', () => {
  const scenes = [
    { id: 'hook', beat: 'hook', type: 'video', path: 'a.mp4', duration: 1, authorized: true, sourceHash: 'a', evidenceRef: 'source a' },
    { id: 'payoff', beat: 'payoff', type: 'video', path: 'b.mp4', duration: 1, authorized: true, sourceHash: 'b', evidenceRef: 'source b' }
  ];
  const validEvidence = { path: 'music.mp3', authorized: true, sha256: 'synthetic', evidenceRef: 'test' };
  assert.throws(() => compileCinematicVlog({ scenes, boundaries: [], music: validEvidence }), /Every scene boundary/);
  assert.throws(() => compileCinematicVlog({ scenes, boundaries: [{ transition: 'cut' }], music: { path: 'music.mp3', authorized: false } }), /Authorized BGM/);
  assert.throws(() => compileCinematicVlog({ scenes: [{ ...scenes[0], audioIntent: 'speech' }, scenes[1]], boundaries: [{ transition: 'cut', rationale: 'test' }], music: validEvidence }), /pre-mixed ducked BGM/);
});
