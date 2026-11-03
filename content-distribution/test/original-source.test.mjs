import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { verifyOriginalInput } from '../scripts/check-original-source.mjs';

function fixture(t) {
  const parent = mkdtempSync(join(tmpdir(), 'rsboost-source-'));
  t.after(() => rmSync(parent, {recursive: true, force: true}));
  const run = join(parent, 'runs', 'test-pilot');
  mkdirSync(join(run, 'assets'), {recursive:true});
  mkdirSync(join(run, 'evidence'), {recursive:true});
  mkdirSync(join(run, 'creatives', 'v1'), {recursive:true});
  const original = join(run, 'assets', 'episode-01.mp4');
  const gen = spawnSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=160x240:r=25', '-t', '0.5', '-c:v', 'mpeg4', original], {encoding:'utf8'});
  assert.equal(gen.status, 0, `ffmpeg failed: ${gen.stderr}`);
  const info = spawnSync('ffprobe', ['-v','error','-show_entries','format=duration','-of','json',original], {encoding:'utf8'});
  const originalBytes = readFileSync(original);
  const source = {kind:'provider_original',provider_id:'rs-boost',episode_number:1,path:'assets/episode-01.mp4',source_url:'https://cps.reelshort.com/resource-square/detail/6ae3078ebd64a138960b78f8?app=reelshort&book_type=0',acquisition_method:'authenticated_rsboost_content_hub',sha256:createHash('sha256').update(originalBytes).digest('hex'),bytes:originalBytes.length,duration_s:Number(JSON.parse(info.stdout).format.duration)};
  const manifest = join(run,'evidence','original-source.json');
  writeFileSync(manifest,JSON.stringify(source));
  writeFileSync(join(run,'evidence','rights.md'),'Test rights evidence');
  writeFileSync(join(run,'campaign.json'),JSON.stringify({provider_id:'rs-boost', original_source_path:'evidence/original-source.json',rights_evidence_path:'evidence/rights.md'}));
  const preview = join(run,'creatives','v1','preview.mp4');
  copyFileSync(original,preview);
  return {run, original, preview, source, manifest};
}

test('accepts only the full original as analysis input even when Preview bytes are identical', async t=>{
  const f=fixture(t);
  const verified=await verifyOriginalInput(f.run,f.original);
  assert.equal(verified.ok,true);
  assert.equal(verified.source_path,realpathSync(f.original));
  await assert.rejects(verifyOriginalInput(f.run,f.preview),/analysis_input_must_be_original_mp4/);
});

test('rejects modified original even with same path and licensed source declaration', async t=>{
  const f=fixture(t);
  writeFileSync(f.original,Buffer.concat([readFileSync(f.original),Buffer.from('tampered')]));
  await assert.rejects(verifyOriginalInput(f.run),/original_size_mismatch/);
});

test('rejects generated creative path as a fake provider original', async t=>{
  const f=fixture(t); f.source.path='creatives/v1/preview.mp4';
  writeFileSync(f.manifest,JSON.stringify(f.source));
  await assert.rejects(verifyOriginalInput(f.run),/invalid_original_path_scope/);
});

test('campaign manifest and Editor require a verified original',()=>{
  const schema=JSON.parse(readFileSync(new URL('../contracts/campaign-plan.schema.json',import.meta.url)));
  assert.ok(schema.required.includes('original_source_path'));
  const prod=readFileSync(new URL('../agents/distribution-editor.agent.md',import.meta.url),'utf8');
  assert.match(prod,/check-original-source\.mjs/);
  assert.match(prod,/Video Use/);
  assert.match(prod,/creatives\/\*\/preview\.mp4/);
});
