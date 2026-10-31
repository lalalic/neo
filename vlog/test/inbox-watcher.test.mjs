import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { processSubmission, scanOnce, episodeJobCreateArgs, episodeJobShowArgs, createCliRelayClient, NEOX_ICLOUD_INBOX_RELATIVE } from '../lib/inbox-watcher.mjs';

async function fixture(manifest, media = { 'media/clip.mov': 'video' }) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vlog-watcher-'));
  const source = path.join(root, 'submission');
  const runs = path.join(root, 'runs');
  await mkdir(path.join(source, 'media'), { recursive: true });
  for (const [name, contents] of Object.entries(media)) {
    await mkdir(path.dirname(path.join(source, name)), { recursive: true });
    await writeFile(path.join(source, name), contents);
  }
  await writeFile(path.join(source, 'manifest.json'), JSON.stringify(manifest));
  return { root, source, runs };
}
function relay() {
  const created = [];
  const planned = [];
  return {
    created, planned,
    getJob: async () => ({ plans: [] }),
    planJob: async (jobId) => { planned.push(jobId); },
    createJob: async ({ submissionId, objectiveFile }) => {
      created.push({ submissionId, objective: await readFile(objectiveFile, 'utf8') });
      return { id: '99001' };
    },
  };
}
const manifest = { schema_version: 1, submission_id: 'submission-1', instruction: 'make a vlog', media: [{ path: 'media/clip.mov' }] };

test('uses the canonical Neox iCloud container path by default', () => {
  assert.equal(NEOX_ICLOUD_INBOX_RELATIVE, 'Library/Mobile Documents/iCloud~com~neox~app/Documents/Vlog Inbox');
});

test('CLI creates durable Job before planning and never supplies an agentGraph', () => {
  const args = episodeJobCreateArgs({ repo: 'lalalic/neo', projectPath: 'vlog', submissionId: 's1', objectiveFile: '/tmp/objective.md' });
  assert.ok(!args.includes('--initial-plan'));
  assert.ok(args.includes('--objective-file'));
  assert.ok(!args.includes('--agent-graph-file'));
  assert.ok(!args.includes('--mode'));
  assert.deepEqual(args.slice(0, 2), ['job', 'create']);
});

test('moves a valid submission and starts one planner-backed job', async () => {
  const f = await fixture(manifest); const r = relay();
  const result = await processSubmission(f.source, { runsDir: f.runs, relay: r, now: new Date('2026-09-27T15:00:00Z') });
  assert.equal(result.status, 'job-planned');
  assert.equal(r.created.length, 1);
  assert.deepEqual(r.planned, ['99001']);
  const hour = String(new Date('2026-09-27T15:00:00Z').getHours()).padStart(2, '0');
  assert.ok(r.created[0].objective.includes(path.join(f.runs, '2026-09-27', hour, 'submission-1', 'input', 'manifest.json')));
  assert.ok(!r.created[0].objective.includes('manifest_metadata:'));
  assert.ok(!r.created[0].objective.includes(JSON.stringify(manifest)));
  await stat(path.join(f.runs, '2026-09-27', hour, 'submission-1', 'input', 'media', 'clip.mov'));
});

test('rejects missing media without moving or creating a task', async () => {
  const f = await fixture(manifest, {}); const r = relay();
  const results = await scanOnce({ inboxDir: f.root, runsDir: f.runs, relay: r });
  assert.equal(results[0].status, 'rejected'); assert.equal(r.created.length, 0); await stat(f.source);
});

test('verifies optional media SHA-256 in ingestion code, not in Planner prompts', async () => {
  const digest = createHash('sha256').update('video').digest('hex');
  const signed = { ...manifest, media: [{ path: 'media/clip.mov', sha256: digest }] };
  const good = await fixture(signed); const r = relay();
  const result = await processSubmission(good.source, { runsDir: good.runs, relay: r });
  assert.equal(result.status, 'job-planned');
  assert.ok(!r.created[0].objective.includes(digest));

  const bad = await fixture({ ...signed, media: [{ path: 'media/clip.mov', sha256: '0'.repeat(64) }] });
  const rejected = await scanOnce({ inboxDir: bad.root, runsDir: bad.runs, relay: relay() });
  assert.equal(rejected[0].status, 'rejected');
  assert.match(rejected[0].reason, /SHA-256 mismatch/);
});

test('rejects media that the availability gate identifies as an iCloud placeholder', async () => {
  const f = await fixture(manifest); const r = relay();
  const results = await scanOnce({ inboxDir: f.root, runsDir: f.runs, relay: r, isLocallyAvailable: async () => false });
  assert.equal(results[0].status, 'rejected'); assert.equal(r.created.length, 0); await stat(f.source);
});

test('rejects traversal and malformed manifests', async () => {
  const traversal = await fixture({ ...manifest, submission_id: 'safe', media: [{ path: '../outside.mov' }] });
  const r = relay(); const result = await scanOnce({ inboxDir: traversal.root, runsDir: traversal.runs, relay: r });
  assert.equal(result[0].status, 'rejected'); assert.equal(r.created.length, 0);
  const malformed = await fixture({ schema_version: 2, submission_id: 'safe', media: ['media/clip.mov'] });
  const result2 = await scanOnce({ inboxDir: malformed.root, runsDir: malformed.runs, relay: r });
  assert.equal(result2[0].status, 'rejected');
});

test('restart and move-before-create recovery remain idempotent', async () => {
  const f = await fixture(manifest); const r = relay();
  const now = new Date('2026-09-27T15:00:00Z');
  const original = r.createJob; r.createJob = async () => { throw new Error('simulated crash window'); };
  await assert.rejects(processSubmission(f.source, { runsDir: f.runs, relay: r, now }));
  r.createJob = original;
  const recovered = await scanOnce({ inboxDir: f.root, runsDir: f.runs, relay: r, now });
  assert.equal(recovered[0].status, 'job-planned'); assert.equal(r.created.length, 1);
  const again = await scanOnce({ inboxDir: f.root, runsDir: f.runs, relay: r, now });
  assert.equal(again[0].status, 'already-jobbed'); assert.equal(r.created.length, 1);
  const hour = String(now.getHours()).padStart(2, '0');
  const movedManifest = path.join(f.runs, '2026-09-27', hour, 'submission-1', 'input', 'manifest.json');
  assert.equal(await readFile(movedManifest, 'utf8') !== '', true);
});


test('manual submission creates a single durable Episode Job across rescans', async () => {
  const f = await fixture(manifest);
  let nextJob = 99001;
  const jobs = [];
  const mock = {
    createJob: async ({ submissionId, objectiveFile }) => {
      jobs.push({ submissionId, objective: await readFile(objectiveFile, 'utf8') });
      return { job: String(nextJob++) };
    },
    getJob: async () => ({ plans: [] }),
    planJob: async () => {},
  };
  const first = await processSubmission(f.source, { runsDir: f.runs, relay: mock, now: new Date('2026-09-27T15:00:00Z') });
  assert.equal(first.jobId, '99001');
  const second = await scanOnce({ inboxDir: path.join(f.root, 'empty'), runsDir: f.runs, relay: mock });
  assert.equal(second[0].status, 'already-jobbed');
  assert.equal(jobs.length, 1);
  assert.equal(JSON.parse(await readFile(path.join(first.runDir, 'episode-job.json'), 'utf8')).jobId, '99001');
});

test('crash after Job creation resumes planning without creating duplicate Job', async () => {
  const f = await fixture(manifest); const r = relay();
  const original = r.planJob;
  r.planJob = async () => { throw new Error('simulated plan transport failure'); };
  await assert.rejects(processSubmission(f.source, { runsDir: f.runs, relay: r }));
  assert.equal(r.created.length, 1);
  r.planJob = original;
  const result = await scanOnce({ inboxDir: path.join(f.root, 'empty'), runsDir: f.runs, relay: r });
  assert.equal(result[0].status, 'plan-recovered');
  assert.equal(r.created.length, 1);
  assert.deepEqual(r.planned, ['99001']);
});

test('lost plan receipt recovers from authoritative successful Plan', async () => {
  const f = await fixture(manifest); const r = relay();
  r.planJob = async () => { throw new Error('receipt delivery lost'); };
  await assert.rejects(processSubmission(f.source, { runsDir: f.runs, relay: r }));
  r.getJob = async () => ({ plans: [{ status: 'SUCCEEDED' }] });
  const result = await scanOnce({ inboxDir: path.join(f.root, 'empty'), runsDir: f.runs, relay: r });
  assert.equal(result[0].status, 'already-jobbed');
  assert.equal(JSON.parse(await readFile(path.join(result[0].runDir, 'episode-plan.json'), 'utf8')).recovered, true);
});

test('Relay recovery fetches the exact Job ID, never the broken broad list endpoint', async () => {
  const calls=[];
  const client=createCliRelayClient({exec:async (bin,args)=>{
    calls.push([bin,...args]);
    return {stdout:JSON.stringify({id:'510',tasks:[{id:'existing-task'}],plans:[]})};
  }});
  assert.deepEqual(episodeJobShowArgs({repo:'lalalic/neo',jobId:510}),['job','show','--repo','lalalic/neo','--id','510']);
  const existing=await client.getJob('510');
  assert.equal(existing.id,'510');
  assert.equal(calls.length,1);
  assert.deepEqual(calls[0].slice(-6),['job','show','--repo','lalalic/neo','--id','510']);
});

test('pre-Planner legacy Job with real work Tasks must not acquire a duplicate Plan', async()=>{
  const f=await fixture(manifest); const r=relay();
  r.planJob=async()=>{throw new Error('simulated delivery loss after Job creation')};
  await assert.rejects(processSubmission(f.source,{runsDir:f.runs,relay:r}));
  r.getJob=async()=>({id:'99001',plans:[],tasks:[{id:'legacy-stage-task'}]});
  let called=0;r.planJob=async()=>{called++};
  const result=await scanOnce({inboxDir:path.join(f.root,'none'),runsDir:f.runs,relay:r});
  assert.equal(result[0].status,'already-jobbed');
  assert.equal(called,0);
  const receipt=JSON.parse(await readFile(path.join(result[0].runDir,'episode-plan.json'),'utf8'));
  assert.equal(receipt.legacyTasks,true);
});
