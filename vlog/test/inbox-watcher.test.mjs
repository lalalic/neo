import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { processSubmission, scanOnce, createCliRelayClient, VLOG_EPISODE_AGENT_GRAPH, NEOX_ICLOUD_INBOX_RELATIVE } from '../lib/inbox-watcher.mjs';

async function fixture(manifest = baseManifest, media = { 'media/clip.mov': 'video' }) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vlog-watcher-'));
  const source = path.join(root, 'submission');
  const inbox = path.join(root, 'inbox');
  const runs = path.join(root, 'runs');
  await mkdir(inbox, { recursive: true });
  await mkdir(path.join(source, 'media'), { recursive: true });
  for (const [name, contents] of Object.entries(media)) {
    await mkdir(path.dirname(path.join(source, name)), { recursive: true });
    await writeFile(path.join(source, name), contents);
  }
  await writeFile(path.join(source, 'manifest.json'), JSON.stringify(manifest));
  await (await import('node:fs/promises')).rename(source, path.join(inbox, 'submission'));
  return { root, source: path.join(inbox, 'submission'), inbox, runs };
}

const baseManifest = {
  schema_version: 2,
  submission_id: 'submission-1',
  master_id: 'master-a',
  source_mode: 'manual_icloud',
  submitted_at: '2026-10-25T15:00:00Z',
  authenticated_submission: { subject_id: 'owner-1', issuer: 'neo-core', assertion_id: 'authz-45', authenticated_at: '2026-10-25T14:59:00Z' },
  source_approval: { status: 'approved', authorization_id: 'consent-19', approved_at: '2026-10-25T14:59:30Z', media_ids: ['asset-1'] },
  media: [{ media_id: 'asset-1', path: 'media/clip.mov', size_bytes: 5, sha256: '0cab1c9617404faf2b24e221e189ca5945813e14d3f766345b09ca13bbe28ffc' }],
};

function relay() {
  const created = [];
  return {
    created,
    listTasks: async () => created,
    createTask: async (task) => { created.push({ id: task.taskId, idempotencyKey: task.idempotencyKey, input: task.input, outputPath: task.outputPath, agentGraph: task.agentGraph }); },
  };
}

test('uses the canonical Neox iCloud container path by default', () => {
  assert.equal(NEOX_ICLOUD_INBOX_RELATIVE, 'Library/Mobile Documents/iCloud~com~neox~app/Documents/Vlog Inbox');
});

test('accepts manually submitted iCloud media into one canonical date-slug run and one Episode Task', async () => {
  const f = await fixture(); const r = relay();
  const result = (await scanOnce({ inboxDir: f.inbox, runsDir: f.runs, relay: r, now: new Date('2026-10-25T15:00:00Z') }))[0];
  assert.equal(result.status, 'task-created');
  assert.equal(path.basename(result.runDir), '2026-10-25-submission-1');
  assert.equal(r.created.length, 1);
  assert.equal(r.created[0].id, 'vlog-episode-submission-1');
  assert.equal(r.created[0].idempotencyKey, 'vlog-episode:submission-1');
  assert.equal(r.created[0].outputPath, path.join('runs', '2026-10-25-submission-1', 'story.md'));
  assert.equal(r.created[0].agentGraph, VLOG_EPISODE_AGENT_GRAPH);
  assert.match(r.created[0].input, /source_mode: manual_icloud/);
  assert.match(r.created[0].input, /authenticated_submission/);
  assert.match(r.created[0].input, /source_approval/);
  assert.match(r.created[0].input, /source-manifest\.json/);
  assert.equal(JSON.parse(await readFile(path.join(result.runDir, 'source-manifest.json'), 'utf8')).submission_id, 'submission-1');
  const intake = JSON.parse(await readFile(path.join(result.runDir, 'intake.json'), 'utf8'));
  assert.equal(intake.media.readiness, 'ready');
  assert.equal(intake.media.completeness, 'complete');
  assert.equal(intake.episode.lifecycle, 'accepted');
  await stat(path.join(result.runDir, 'input', 'media', 'clip.mov'));
});

test('source-use approval gates task creation separately from media completeness', async () => {
  const f = await fixture({ ...baseManifest, source_approval: { status: 'pending', authorization_id: 'consent-19', media_ids: ['asset-1'] } });
  const r = relay();
  const result = (await scanOnce({ inboxDir: f.inbox, runsDir: f.runs, relay: r }))[0];
  assert.equal(result.status, 'permission-needed');
  assert.equal(r.created.length, 0);
  const intake = JSON.parse(await readFile(path.join(result.runDir, 'intake.json'), 'utf8'));
  assert.equal(intake.media.readiness, 'unknown');
  assert.equal(intake.media.completeness, 'unknown');
  assert.equal(intake.episode.lifecycle, 'not-created');
});

test('detects incomplete and late media without creating an Episode Task', async () => {
  const f = await fixture(baseManifest, {}); const r = relay();
  const result = (await scanOnce({ inboxDir: f.inbox, runsDir: f.runs, relay: r, now: new Date('2026-10-27T15:00:00Z'), lateAfterMs: 60_000 }))[0];
  assert.equal(result.status, 'late-incomplete');
  assert.equal(r.created.length, 0);
  assert.equal((await readFile(path.join(f.source, 'manifest.json'), 'utf8')).length > 0, true);
  const intake = JSON.parse(await readFile(path.join(result.runDir, 'intake.json'), 'utf8'));
  assert.equal(intake.media.readiness, 'incomplete');
  assert.equal(intake.media.completeness, 'incomplete');
});

test('rejects iCloud placeholders, wrong lengths, and checksum mismatches', async () => {
  const f = await fixture(); const r = relay();
  const results = await scanOnce({ inboxDir: f.inbox, runsDir: f.runs, relay: r, isLocallyAvailable: async () => false });
  assert.equal(results[0].status, 'incomplete'); assert.equal(r.created.length, 0);
  const wrongSize = await fixture({ ...baseManifest, media: [{ ...baseManifest.media[0], size_bytes: 100 }] });
  assert.equal((await scanOnce({ inboxDir: wrongSize.inbox, runsDir: wrongSize.runs, relay: r }))[0].status, 'incomplete');
  const wrongHash = await fixture({ ...baseManifest, media: [{ ...baseManifest.media[0], sha256: '0'.repeat(64) }] });
  assert.equal((await scanOnce({ inboxDir: wrongHash.inbox, runsDir: wrongHash.runs, relay: r }))[0].status, 'incomplete');
  assert.equal(r.created.length, 0);
});

test('rejects unauthenticated identities and media not covered by approval', async () => {
  const unauth = await fixture({ ...baseManifest, authenticated_submission: null });
  const uncovered = await fixture({ ...baseManifest, source_approval: { ...baseManifest.source_approval, media_ids: [] } });
  const r = relay();
  assert.equal((await scanOnce({ inboxDir: unauth.inbox, runsDir: unauth.runs, relay: r }))[0].status, 'identity-needed');
  assert.equal((await scanOnce({ inboxDir: uncovered.inbox, runsDir: uncovered.runs, relay: r }))[0].status, 'permission-needed');
  assert.equal(r.created.length, 0);
});

test('recovers a crash after the final manifest move, deduplicates scans, and retains one Episode identity', async () => {
  const f = await fixture(); const r = relay();
  r.createTask = async () => { throw new Error('simulated process exit after move'); };
  await assert.rejects(processSubmission(f.source, { runsDir: f.runs, relay: r, now: new Date('2026-10-25T15:00:00Z') }));
  r.createTask = async (task) => { r.created.push({ id: task.taskId, idempotencyKey: task.idempotencyKey, input: task.input, outputPath: task.outputPath, agentGraph: task.agentGraph }); };
  const recovered = await scanOnce({ inboxDir: f.inbox, runsDir: f.runs, relay: r, now: new Date('2026-10-25T15:00:00Z') });
  assert.equal(recovered[0].status, 'task-created'); assert.equal(r.created.length, 1);
  const again = await scanOnce({ inboxDir: f.inbox, runsDir: f.runs, relay: r, now: new Date('2026-10-25T15:00:00Z') });
  assert.equal(again[0].status, 'already-tasked'); assert.equal(r.created.length, 1);
  assert.equal(new Set(r.created.map((task) => task.id)).size, 1);
  assert.equal(JSON.parse(await readFile(path.join(f.runs, '2026-10-25-submission-1', 'intake.json'), 'utf8')).episode.lifecycle, 'accepted');
});

test('keeps incomplete submissions visible and does not imply accepted or finished lifecycle', async () => {
  const f = await fixture(baseManifest, {}); const r = relay();
  const result = (await scanOnce({ inboxDir: f.inbox, runsDir: f.runs, relay: r }))[0];
  assert.equal(result.status, 'incomplete');
  const intake = JSON.parse(await readFile(path.join(result.runDir, 'intake.json'), 'utf8'));
  assert.equal(intake.episode.lifecycle, 'not-created');
  assert.equal(r.created.length, 0);
});

test('allocates/binds the Relay Job through CLI and creates one idempotent file-output Task', async () => {
  const calls = [];
  const client = createCliRelayClient({
    env: { VLOG_RELAY_REPO: 'lalalic/neo', VLOG_RELAY_PR: '129' },
    execFileAsync: async (_command, args) => {
      calls.push(args);
      if (args.includes('adopt')) return { stdout: JSON.stringify({ job: { id: '42' } }) };
      if (args.includes('list')) return { stdout: '[]' };
      return { stdout: '{}'};
    },
  });
  await client.listTasks();
  await client.createTask({ taskId: 'vlog-episode-submission-1', idempotencyKey: 'vlog-episode:submission-1', input: 'input', outputPath: 'runs/2026-10-25-submission-1/story.md', agentGraph: VLOG_EPISODE_AGENT_GRAPH });
  assert.equal(calls.filter((args) => args.includes('adopt')).length, 1);
  assert.equal(calls.filter((args) => args.includes('create')).length, 1);
  assert.ok(calls[0].includes('--repo') && calls[0].includes('--pr'));
  assert.ok(calls[2].includes('42'));
  assert.ok(calls[2].includes('--idempotency-key'));
  assert.ok(calls[2].includes('--output-path'));
});
