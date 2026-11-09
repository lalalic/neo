import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { run } from '../agents/vlog-visioner.agent.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const execFileAsync = promisify(execFile);

async function fixture(t, withMetadata = false) {
  const root = await mkdtemp(join(tmpdir(), 'neo-vision-shortcut-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const vlogRoot = join(root, 'vlog');
  await mkdir(join(vlogRoot,'scripts'),{recursive:true});
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
      if (args.includes('--normalize-only')) {
        const mediaArg=args[args.indexOf('vision')+1];
        const dir=join(mediaArg,'.normalized'); await mkdir(dir,{recursive:true});
        const path=join(dir,'CLIP_0to4.mp4');
        await writeFile(path,'normalized fixture understanding bytes');
        return {code:0,stdout:JSON.stringify({status:'PASS',profile:'markcut-vision-normalized-v1',usage:'vision-understanding-only',
          files:[{source:'CLIP.mp4',path,kind:'video',sampled:false,sourceDurationSeconds:4,maxDimension:360}]})};
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
  assert.equal(Object.hasOwn(result.artifacts,'vision-segment-index.json'),false);
  assert.ok(result.artifacts['metadata.json'].CLIP);
  assert.equal(result.artifacts['vision-normalized-manifest.json'].sources[0].normalizedPath,'input/media/.normalized/CLIP_0to4.mp4');
  assert.equal(host.calls.length, 1);
  const evidence = JSON.parse(await readFile(join(f.runPath, 'vision-evidence.json'), 'utf8'));
  assert.equal(evidence.status, 'EVIDENCE_READY_UNREVIEWED');
  assert.equal(evidence.sources[0].source_sha256, hash('fixture media bytes'));
  assert.equal(evidence.observations[0].source_time_start_seconds, 0);
  assert.equal(evidence.observations[0].status, 'MODEL_OUTPUT_UNREVIEWED');
  assert.match(evidence.acceptance, /not Director acceptance, human approval/);
});

test('direct evidence preserves byte-exact provenance for a pretty-printed approved manifest', async t => {
  const f = await fixture(t, true);
  const manifestPath = join(f.runPath, 'source-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
  assert.notEqual(hash(manifestBytes), hash(JSON.stringify(manifest)));
  await writeFile(manifestPath, manifestBytes);
  const stub=join(f.vlogRoot,'scripts','markcut-normalize-stub.mjs');
  await writeFile(stub,`import {writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
const dir=process.argv[3];const out=join(dir,'.normalized');mkdirSync(out,{recursive:true});
const path=join(out,'CLIP_0to4.mp4');writeFileSync(path,'small vision bytes');
console.log(JSON.stringify({status:'PASS',profile:'markcut-vision-normalized-v1',usage:'vision-understanding-only',
 files:[{source:'CLIP.mp4',path,kind:'video',sampled:false,sourceDurationSeconds:4,maxDimension:360}]}));`);
  const commands = [];
  const result = await run({ input: { projectPath:f.vlogRoot, runPath:f.runPath,markcutCommand:[process.execPath,stub] },
    runCommand: async (argv, cwd) => {
      commands.push(argv);
      const { stdout, stderr } = await execFileAsync(argv[0],argv.slice(1),{cwd});
      return {code:0,stdout,stderr};
    },
  });
  assert.equal(result.status,'COMPLETED');
  assert.deepEqual(result.markcut,{invoked:false,reused:true});
  assert.equal(commands.length,1);
  assert.equal(result.evidence.manifest_hash,hash(manifestBytes));
  assert.equal(result.evidence.markcut_metadata_sha256,hash(await readFile(join(f.mediaDir,'metadata.json'))));
  await assert.rejects(readFile(join(f.runPath,'vision-segment-index.json')),{code:'ENOENT'});
  assert.equal(result.evidence.sources.length,1);
  assert.equal(result.evidence.observations.length,1);
});

test('raw phone folder without metadata auto-runs Markcut Vision, preserving sources and normalizing originals', async t => {
  const f = await fixture(t, false);
  const host = fakeHost();
  const result = await run({ input: { projectPath:f.root, vlogRoot: f.vlogRoot, runPath: f.runPath }, ...host });
  assert.equal(result.status, 'COMPLETED');
  assert.deepEqual(result.markcut, {invoked:true,reused:false});
  assert.deepEqual(host.calls[0].args, ['markcut','vision',await realpath(f.mediaDir)]);
  assert.ok(host.calls[1].args.includes('--normalize-only'));
  assert.equal(result.evidence.sources[0].source_sha256,hash('fixture media bytes'));
});

test('default semantic-Agent failure retries through Markcut with a real Codex CLI template', async t => {
  const f=await fixture(t,false);
  const host=fakeHost();
  const base=host.runCommand;
  let attempts=0;
  host.runCommand=async (args,cwd) => {
    if(args.includes('vision')&&!args.includes('--normalize-only')&&!args.includes('--help')) {
      attempts++;
      if(attempts===1) {
        host.calls.push({args,cwd});
        return {code:1,stdout:'',stderr:'Semantic segmentation Agent returned no valid structured response'};
      }
    }
    return base(args,cwd);
  };
  const result=await run({input:{projectPath:f.root,vlogRoot:f.vlogRoot,runPath:f.runPath},...host});
  assert.equal(result.status,'COMPLETED');
  assert.equal(attempts,2);
  const agentAt=host.calls[1].args.indexOf('--agent');
  assert.ok(agentAt>0);
  assert.match(host.calls[1].args[agentAt+1],/^codex exec --profile zai .*\{prompt\}$/);
});

test('non-semantic Markcut failures do not trigger unrelated adapter retries', async t => {
  const f=await fixture(t,false);
  const host=fakeHost();
  host.runCommand=async (args,cwd) => {
    host.calls.push({args,cwd});
    return {code:1,stdout:'',stderr:'Permission denied on original media'};
  };
  await assert.rejects(run({input:{projectPath:f.root,vlogRoot:f.vlogRoot,runPath:f.runPath},...host}),/Permission denied/);
  assert.equal(host.calls.length,1);
});

test('explicitly configured ITT/VTT adapters remain supported for raw folders', async t => {
  const f = await fixture(t, false);
  const host = fakeHost();
  const result = await run({ input: {
    projectPath:f.root, vlogRoot:f.vlogRoot, runPath:f.runPath,
    markcutCommand:['node','/mock/markcut/cli.mjs'], adapterCommand:['node','/mock/deepseek.mjs'],
  }, ...host });
  assert.equal(result.status,'COMPLETED');
  assert.deepEqual(host.calls[1].args.slice(0,3),['node','/mock/markcut/cli.mjs','vision']);
  assert.ok(host.calls[1].args.includes('--itt'));
  assert.ok(host.calls[1].args.includes('--vtt'));
  assert.ok(host.calls.some(call=>call.args.includes('--normalize-only')));
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

test('explicitly disabled inference fails closed for a raw folder; metadata is not fabricated', async t => {
  const f=await fixture(t,false);
  const host=fakeHost();
  await assert.rejects(run({input:{projectPath:f.root,vlogRoot:f.vlogRoot,runPath:f.runPath,allowInference:false},...host}),/inference was explicitly disabled/);
  assert.equal(host.calls.length,0);
  await assert.rejects(readFile(join(f.runPath,'vision-evidence.json')),{code:'ENOENT'});
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

test('rejects source symlink escapes without duplicate metadata checks', async t => {
  const f=await fixture(t,true);
  const outside=join(f.vlogRoot,'outside.mp4'); await writeFile(outside,'fixture media bytes');
  await (await import('node:fs/promises')).rm(join(f.mediaDir,'CLIP.mp4'));
  await symlink(outside,join(f.mediaDir,'CLIP.mp4'));
  const host=fakeHost();
  await assert.rejects(run({input:{projectPath:f.root,vlogRoot:f.vlogRoot,runPath:f.runPath},...host}),/out-of-scope source|source original/);
  assert.equal(host.calls.length,0);
  const f2=await fixture(t,true); const manifest=JSON.parse(await readFile(join(f2.runPath,'source-manifest.json'),'utf8'));
  manifest.markcut_metadata_sha256='0'.repeat(64); await writeFile(join(f2.runPath,'source-manifest.json'),JSON.stringify(manifest));
  const success=await run({input:{projectPath:f2.root,vlogRoot:f2.vlogRoot,runPath:f2.runPath},...fakeHost()});
  assert.equal(success.status,'COMPLETED'); // Outdated checksum metadata does not block Stage output.
});

test('interrupted extraction-only metadata is refreshed through Markcut Vision',async t=>{
  const f=await fixture(t,true);
  const metadataPath=join(f.mediaDir,'metadata.json');
  const metadata=JSON.parse(await readFile(metadataPath,'utf8'));
  delete metadata.CLIP;
  await writeFile(metadataPath,JSON.stringify(metadata));
  const host=fakeHost();
  const result=await run({input:{projectPath:f.root,vlogRoot:f.vlogRoot,runPath:f.runPath},...host});
  assert.equal(result.status,'COMPLETED');
  assert.deepEqual(result.markcut,{invoked:true,reused:false});
  assert.deepEqual(host.calls[0].args,['markcut','vision',await realpath(f.mediaDir)]);
  assert.ok(host.calls[1].args.includes('--normalize-only'));
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
  assert.equal(result.evidence.uncertainty.length, 0);
  assert.equal(result.evidence.observations.length, 2);
  assert.ok(result.evidence.observations.every(item => item.status === 'MODEL_OUTPUT_UNREVIEWED'));
  assert.match(JSON.stringify(result.evidence), /Thank you/);
  assert.equal(host.calls.length, 1, 'native Markcut normalizer only; no indexing CLI or mandatory preview');
  await assert.rejects(readFile(join(f.runPath, 'vision-human-review.json')), { code: 'ENOENT' });
});
