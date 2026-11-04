import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { indexFromRun } from '../scripts/index-markcut-vision.mjs';
import { run } from '../agents/.shortcut/vlog-visioner.agent.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const execFileAsync = promisify(execFile);

async function fixture(t, withMetadata = false) {
  const root = await mkdtemp(join(tmpdir(), 'neo-vision-shortcut-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const vlogRoot = join(root, 'vlog');
  await mkdir(join(vlogRoot,'scripts'),{recursive:true});
  await writeFile(join(vlogRoot,'scripts/index-markcut-vision.mjs'),'// fixture command target');
  const runPath = join(vlogRoot, 'runs', '2026-11-02-shortcut-test');
  const mediaDir = join(runPath, 'input', 'media');
  await mkdir(mediaDir, { recursive: true });
  const mediaPath = join(mediaDir, 'CLIP.mp4');
  await writeFile(mediaPath, 'fixture media bytes');
  const manifest = {
    source_use: { approved: true, scope: 'private test' },
    media: [{ id: 'CLIP', path: 'CLIP.mp4', original_path: mediaPath, sha256: hash('fixture media bytes') }],
    canonical_source_directory: mediaDir,
  };
  if (withMetadata) {
    const metadata=JSON.stringify({
    CLIP: { duration: 4, perception: { desc: 'Observed pathway', segments: { '0to2000': { vision: 'Trees' } } } },
    });
    await writeFile(join(mediaDir, 'metadata.json'), metadata);
    manifest.markcut_metadata_sha256=hash(metadata);
  }
  await writeFile(join(runPath, 'source-manifest.json'), JSON.stringify(manifest));
  return { root, vlogRoot, runPath, mediaDir };
}

function fakeHost() {
  const calls = [];
  return {
    calls,
    runCommand: async (args, cwd) => {
      calls.push({ args, cwd });
      if (args.includes('--help')) return { code: 0, stdout: 'vision --itt {prompt_quoted} --vtt {sample_interval}' };
      if (args[1]?.endsWith('index-markcut-vision.mjs')) {
        const index = indexFromRun(args[2]);
        await writeFile(join(args[2], 'vision-segment-index.json'), `${JSON.stringify(index)}\n`);
        return { code: 0, stdout: '{}' };
      }
      if (args.includes('vision') && !args.includes('--help')) {
        const mediaArg = args[args.indexOf('vision') + 1];
        const metadata = join(mediaArg, 'metadata.json');
        await writeFile(metadata, JSON.stringify({
          CLIP: { duration: 4, perception: { desc: 'Observed pathway', segments: { '0to2000': { vision: 'Trees' } } } },
        }));
        return { code: 0, stdout: 'metadata updated' };
      }
      throw new Error(`Unexpected command: ${args.join(' ')}`);
    },
  };
}

test('reuses approved Markcut metadata and writes source-linked, explicitly unreviewed evidence', async t => {
  const f = await fixture(t, true);
  const host = fakeHost();
  const result = await run({ input: { projectPath:f.root, vlogRoot: f.vlogRoot, runPath: f.runPath }, ...host });
  assert.equal(result.status, 'COMPLETED');
  assert.deepEqual(result.markcut, { invoked: false, reused: true });
  assert.ok(result.artifacts['vision-evidence.json']);
  assert.ok(result.artifacts['vision-segment-index.json']);
  assert.ok(result.artifacts['metadata.json'].CLIP);
  assert.equal(host.calls.length, 1);
  const evidence = JSON.parse(await readFile(join(f.runPath, 'vision-evidence.json'), 'utf8'));
  assert.equal(evidence.status, 'EVIDENCE_READY_UNREVIEWED');
  assert.equal(evidence.sources[0].source_sha256, hash('fixture media bytes'));
  assert.equal(evidence.observations[0].source_time_start_seconds, 0);
  assert.equal(evidence.observations[0].status, 'MODEL_OUTPUT_UNREVIEWED');
  assert.match(evidence.acceptance, /not Director acceptance, human approval/);
});

test('real subprocess indexes a pretty-printed approved manifest with byte-exact provenance', async t => {
  const f = await fixture(t, true);
  const manifestPath = join(f.runPath, 'source-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
  assert.notEqual(hash(manifestBytes), hash(JSON.stringify(manifest)));
  await writeFile(manifestPath, manifestBytes);
  await copyFile(fileURLToPath(new URL('../scripts/index-markcut-vision.mjs', import.meta.url)),
    join(f.vlogRoot, 'scripts/index-markcut-vision.mjs'));
  const commands = [];
  const result = await run({ input: { projectPath:f.vlogRoot, runPath:f.runPath },
    runCommand: async (argv, cwd) => {
      commands.push(argv);
      const { stdout, stderr } = await execFileAsync(argv[0],argv.slice(1),{cwd});
      return {code:0,stdout,stderr};
    },
  });
  assert.equal(result.status,'COMPLETED');
  assert.deepEqual(result.markcut,{invoked:false,reused:true});
  assert.equal(commands.length,1);
  const indexBytes = await readFile(join(f.runPath,'vision-segment-index.json'));
  assert.equal(result.artifacts['vision-segment-index.json'].manifest_hash,hash(manifestBytes));
  assert.equal(result.evidence.vision_segment_index_sha256,hash(indexBytes));
  assert.equal(result.evidence.sources.length,1);
  assert.equal(result.evidence.observations.length,1);
});

test('missing metadata requires explicit inference authorization and accepted CLI templates', async t => {
  const f = await fixture(t, false);
  const host = fakeHost();
  await assert.rejects(run({ input: { projectPath:f.root, vlogRoot: f.vlogRoot, runPath: f.runPath }, ...host }), /explicit inference authorization/);
  assert.equal(host.calls.length, 0);
  const result = await run({ input: {
    projectPath:f.root, vlogRoot: f.vlogRoot, runPath: f.runPath, allowInference: true,
    markcutCommand: ['node', '/mock/markcut/cli.mjs'], adapterCommand: ['node', '/mock/deepseek.mjs'],
  }, ...host });
  assert.equal(result.status, 'COMPLETED');
  assert.deepEqual(host.calls[1].args.slice(0, 3), ['node', '/mock/markcut/cli.mjs', 'vision']);
  assert.ok(host.calls[1].args.includes('--itt'));
  assert.ok(host.calls[1].args.includes('--vtt'));
});

test('fails closed on unsupported CLI options and preserves existing evidence', async t => {
  const f = await fixture(t, false);
  const evidencePath = join(f.runPath, 'vision-evidence.json');
  await writeFile(evidencePath, 'approved evidence');
  await assert.rejects(run({ input: { projectPath:f.root, vlogRoot: f.vlogRoot, runPath: f.runPath }, runCommand: async () => ({ code: 0, stdout: '' }) }), /Refusing to overwrite/);
  await rm(evidencePath);
  const host = fakeHost();
  host.runCommand = async (args, cwd) => { host.calls.push({ args, cwd }); return { code: 0, stdout: 'vision --itt only' }; };
  await assert.rejects(run({ input: {
    projectPath:f.root, vlogRoot: f.vlogRoot, runPath: f.runPath, allowInference: true,
    markcutCommand: ['node', 'cli.mjs'], adapterCommand: ['node', 'adapter.mjs'],
  }, ...host }), /does not advertise required template support/);
  assert.equal(host.calls.length, 1);
});

test('rejects unapproved manifests before calling external tools', async t => {
  const f = await fixture(t, false);
  const path = join(f.runPath, 'source-manifest.json');
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  manifest.source_use.approved = false;
  await writeFile(path, JSON.stringify(manifest));
  const host = fakeHost();
  await assert.rejects(run({ input: { projectPath:f.root, vlogRoot: f.vlogRoot, runPath: f.runPath, allowInference: true }, ...host }), /owner-approved source manifest/);
  assert.equal(host.calls.length, 0);
});

test('rejects a dated run symlink that escapes the private Vlog runs directory', async t => {
  const f = await fixture(t, true);
  const outside = join(f.vlogRoot, 'outside-run');
  await mkdir(outside, { recursive: true });
  const link = join(f.vlogRoot, 'runs', '2026-11-03-escape');
  await symlink(outside, link, 'dir');
  const host = fakeHost();
  await assert.rejects(run({ input: { projectPath:f.root, vlogRoot: f.vlogRoot, runPath: link }, ...host }), /dated canonical Vlog runs/);
  assert.equal(host.calls.length, 0);
});

test('pins the supplied Vlog root to the resolved project root',async t=>{
  const f=await fixture(t,true); const outside=await mkdtemp(join(tmpdir(),'neo-vlog-root-'));
  t.after(()=>rm(outside,{recursive:true,force:true}));
  const host=fakeHost();
  await assert.rejects(run({input:{projectPath:f.root,vlogRoot:outside,runPath:f.runPath},...host}),/escapes the resolved project root/);
  assert.equal(host.calls.length,0);
});

test('rejects source symlink escapes and stale approved metadata hashes', async t => {
  const f=await fixture(t,true);
  const outside=join(f.vlogRoot,'outside.mp4'); await writeFile(outside,'fixture media bytes');
  await (await import('node:fs/promises')).rm(join(f.mediaDir,'CLIP.mp4'));
  await symlink(outside,join(f.mediaDir,'CLIP.mp4'));
  const host=fakeHost();
  await assert.rejects(run({input:{projectPath:f.root,vlogRoot:f.vlogRoot,runPath:f.runPath},...host}),/out-of-scope source|source original/);
  assert.equal(host.calls.length,1);
  const f2=await fixture(t,true); const manifest=JSON.parse(await readFile(join(f2.runPath,'source-manifest.json'),'utf8'));
  manifest.markcut_metadata_sha256='0'.repeat(64); await writeFile(join(f2.runPath,'source-manifest.json'),JSON.stringify(manifest));
  await assert.rejects(run({input:{projectPath:f2.root,vlogRoot:f2.vlogRoot,runPath:f2.runPath},...fakeHost()}),/metadata changed since manifest approval/);
});

test('rejects fake index output that does not prove the approved manifest and metadata hashes', async t=>{
  const f=await fixture(t,true); const host=fakeHost();
  host.runCommand=async (args,cwd)=>{
    host.calls.push({args,cwd});
    if(args.includes('--help')) return {code:0,stdout:'vision --itt {prompt_quoted} --vtt {sample_interval}'};
    await writeFile(join(args[2],'vision-segment-index.json'),JSON.stringify({status:'SOURCE_LINKED_UNREVIEWED',findings:[],sources:[],observations:[]}));
    return {code:0,stdout:'{}'};
  };
  await assert.rejects(run({input:{projectPath:f.root,vlogRoot:f.vlogRoot,runPath:f.runPath},...host}),/provenance hashes/);
});

test('Relay project-root and canonical Task text resolve the Vlog source without a nested vlog/vlog path',async t=>{
  const f=await fixture(t,true);
  const host=fakeHost();
  const result=await run({input:{
    projectPath:f.vlogRoot,
    taskInput:`Run selected Neo Project.\n- Canonical run: ${f.runPath}\n`
  },...host});
  assert.equal(result.status,'COMPLETED');
  assert.equal(result.markcut.reused,true);
  assert.equal(host.calls.length,1);
});
test('Vlog project shortcut does not accept a run from a separate project',async t=>{
  const f=await fixture(t,true);
  const other=join(f.root,'content-distribution','runs','2026-11-03-elsewhere');
  await mkdir(other,{recursive:true});
  await assert.rejects(run({input:{projectPath:f.vlogRoot,runPath:other},...fakeHost()}),
    /dated canonical Vlog runs/);
});

test('unverified speech and absent optional source-preview approval do not block Visioner evidence handoff', async t => {
  // Regression for Job 553: the 1.57s clip has a machine-only \"Thank you\" hint.
  // The source evidence must complete without claiming verified speech or
  // requesting the Producer-only canonical preview approval at this Stage.
  const f = await fixture(t, true);
  const metaPath = join(f.mediaDir, 'metadata.json');
  const metadata = { CLIP: { duration: 1.57, perception: { desc: 'Creek and rocks',
    segments: { '0to940': { vision: 'Shallow creek', subtitle: 'Thank you.' },
      '940to1570': { vision: 'Water beside vegetation' } } } } };
  const rawMetadata = JSON.stringify(metadata);
  await writeFile(metaPath, rawMetadata);
  const manifestPath = join(f.runPath, 'source-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.markcut_metadata_sha256 = hash(rawMetadata);
  await writeFile(manifestPath, JSON.stringify(manifest));
  const host = fakeHost();
  const result = await run({ input: { projectPath: f.vlogRoot, runPath: f.runPath }, ...host });
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.evidence.status, 'EVIDENCE_READY_UNREVIEWED');
  assert.equal(result.artifacts['vision-segment-index.json'].findings.length, 0);
  assert.equal(result.evidence.observations.length, 2);
  assert.ok(result.evidence.observations.every(item => item.status === 'MODEL_OUTPUT_UNREVIEWED'));
  assert.match(JSON.stringify(result.evidence), /Thank you/);
  assert.equal(host.calls.length, 1, 'only the source indexer runs; no mandatory preview or approval');
  await assert.rejects(readFile(join(f.runPath, 'vision-human-review.json')), { code: 'ENOENT' });
});
