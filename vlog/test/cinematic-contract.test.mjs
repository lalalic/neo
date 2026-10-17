import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validateEpisodeSources, validateReviewGate, validatePlaybackQA } from '../lib/cinematic-contract.mjs';

test('source admission verifies real bytes, window, approval and ranges', async () => {
  const run = await mkdtemp(path.join(tmpdir(), 'vlog-source-'));
  try {
    await mkdir(path.join(run, 'assets'));
    const bytes = Buffer.from('deterministic test bytes, NOT purported footage');
    await writeFile(path.join(run, 'assets/fixture.dat'), bytes);
    const item = {
      id:'test', local_relative_path:'assets/fixture.dat', sha256:createHash('sha256').update(bytes).digest('hex'),
      origin:'manual', media_type:'video', captured_at:'2026-10-10T10:00:00Z', original_audio:false,
      permission:{owner_confirmed:true,use_approved:true}, duration:5, selected_ranges:[{start:0,end:4}]
    };
    const manifest = {schema_version:1,source_window:{start:'2026-10-10T00:00:00Z',end:'2026-10-11T00:00:00Z'},episode_intent:'technical test',items:[item]};
    assert.equal((await validateEpisodeSources(run, manifest)).admissible, true);
    await assert.rejects(validateEpisodeSources(run,{...manifest,items:[]}),/INSUFFICIENT_SOURCE/);
    await assert.rejects(validateEpisodeSources(run,{...manifest,items:[{...item,sha256:'0'.repeat(64)}]}),/checksum/);
    await assert.rejects(validateEpisodeSources(run,{...manifest,items:[{...item,permission:{owner_confirmed:false,use_approved:true}}]}),/rights/);
    await assert.rejects(validateEpisodeSources(run,{...manifest,items:[{...item,local_relative_path:'../outside.mp4'}]}),/outside run/);
    await assert.rejects(validateEpisodeSources(run,{...manifest,items:[{...item,selected_ranges:[{start:4,end:6}]}]}),/range/);
    await assert.rejects(validateEpisodeSources(run,{...manifest,items:[{...item,captured_at:'2024-01-01T00:00:00Z'}]}),/capture/);
  } finally { await rm(run,{recursive:true,force:true}); }
});

test('dual reviews must match current draft and playback must meet hard rubric', () => {
  const md = '# real draft';
  const digest = createHash('sha256').update(md).digest('hex');
  const review = {status:'PASS',draft_sha256:digest,reviewer:'independent reviewer',reviewed_at:'2026-10-10T10:00:00Z'};
  assert.equal(validateReviewGate(md,{'video-director':review,market:review}).approved,true);
  assert.throws(()=>validateReviewGate(md+' revised',{'video-director':review,market:review}),/stale/);
  assert.throws(()=>validateReviewGate(md,{'video-director':review,market:{...review,status:'CHANGE_REQUIRED'}}),/approval/);
  const qa = {played_entire_render:true,render_sha256:digest,player:'real local player',viewer:'reviewer',playback_at:'2026-10-10T10:00:00Z',timecoded_observations:[{at:1,note:'test only'}],critical_defects:0,scores:{source:18,narrative:14,shots:14,visual:14,pacing:9,sound:14,graphics:9}};
  assert.equal(validatePlaybackQA(qa).passed,true);
  assert.throws(()=>validatePlaybackQA({...qa,played_entire_render:false}),/playback/);
  assert.throws(()=>validatePlaybackQA({...qa,critical_defects:1}),/critical/);
  assert.throws(()=>validatePlaybackQA({...qa,scores:{...qa.scores,sound:5}}),/sound/);
});
