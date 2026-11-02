import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inferDeepSeekVisual, parseDeepSeekInferArgs } from './deepseek-infer.mjs';

const dir = mkdtempSync(join(tmpdir(), 'neo-vision-hook-eval-'));
const a = join(dir, 'first.png');
const b = join(dir, 'second.png');
const video = join(dir, 'clip.mp4');
function fakeSession() {
  const state = { starts: 0, batches: 0, refreshes: 0 };
  return {
    state,
    start() { state.starts++; },
    refreshLease() { state.refreshes++; },
    analyze(_sheet, prompt) {
      state.batches++;
      const ids = [...prompt.matchAll(/^(T\d{3}) — /gm)].map(match => match[1]);
      return JSON.stringify({ tiles: ids.map(id => ({ id, description: `Observed ${id}` })) });
    }
  };
}
test('generic CLI parser accepts quoted prompt and media paths', () => {
  assert.deepEqual(parseDeepSeekInferArgs(['--prompt', '骑车 $(echo NO)', '--input', a]),
    { prompt: '骑车 $(echo NO)', inputs: [a], sampleInterval: 5, batchSize: 8 });
  assert.throws(() => parseDeepSeekInferArgs(['--batch-size', '99', a]), /Invalid/);
});
test('private adapter returns independently labeled image observations', () => {
  try {
    execFileSync('ffmpeg', ['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','color=c=blue:s=80x60','-frames:v','1',a]);
    execFileSync('ffmpeg', ['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','color=c=red:s=80x60','-frames:v','1',b]);
    const session = fakeSession();
    const output = inferDeepSeekVisual({inputs: [a,b], prompt:'在 Ottawa 骑车', session});
    assert.match(output,/first\.png:/);
    assert.match(output,/second\.png:/);
    assert.match(output,/T001/);
    assert.match(output,/T002/);
    assert.equal(session.state.batches, 1);
    assert.equal(session.state.starts, 1);
  } finally { /* shared fixtures cleaned after last test */ }
});
test('private adapter timestamps sampled video frames, splits into batches and rejects missing IDs', () => {
  try {
    execFileSync('ffmpeg', ['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','testsrc=size=80x60:rate=8:duration=3','-c:v','libx264','-pix_fmt','yuv420p',video]);
    const session = fakeSession();
    const output = inferDeepSeekVisual({inputs: [video], sampleInterval:1, batchSize:2, session});
    assert.match(output,/clip\.mp4:/);
    assert.match(output,/\d+\.\d{2}s: Observed/);
    assert.ok(session.state.batches >= 2);
    assert.equal(session.state.refreshes, session.state.batches);
    assert.throws(() => inferDeepSeekVisual({inputs:[a],session:{...fakeSession(),analyze:()=>'{"tiles":[]}'}}), /mismatch/);
  } finally { rmSync(dir,{force:true,recursive:true}); }
});
