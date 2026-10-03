import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { processSubmission, scanOnce, VLOG_EPISODE_AGENT_GRAPH, NEOX_ICLOUD_INBOX_RELATIVE } from '../lib/inbox-watcher.mjs';

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
  return {
    created,
    listTasks: async () => created,
    createTask: async (task) => {
      created.push({ id: task.taskId, input: task.input, agentGraph: task.agentGraph });
    },
  };
}
const manifest = { schema_version: 1, submission_id: 'submission-1', instruction: 'make a vlog', media: [{ path: 'media/clip.mov' }] };

test('uses the canonical Neox iCloud container path by default', () => {
  assert.equal(NEOX_ICLOUD_INBOX_RELATIVE, 'Library/Mobile Documents/iCloud~com~neox~app/Documents/Vlog Inbox');
});

test('moves a valid submission and creates one task pointing at moved input', async () => {
  const f = await fixture(manifest); const r = relay();
  const result = await processSubmission(f.source, { runsDir: f.runs, relay: r, now: new Date('2026-09-27T15:00:00Z') });
  assert.equal(result.status, 'task-created');
  assert.equal(r.created.length, 1);
  assert.equal(r.created[0].agentGraph, VLOG_EPISODE_AGENT_GRAPH);
  assert.match(r.created[0].agentGraph, /editor\[agent:vlog-editor\] --> producer\[agent:vlog-producer\]/);
  const hour = String(new Date('2026-09-27T15:00:00Z').getHours()).padStart(2, '0');
  assert.ok(r.created[0].input.includes(path.join(f.runs, '2026-09-27', hour, 'submission-1', 'input', 'manifest.json')));
  await stat(path.join(f.runs, '2026-09-27', hour, 'submission-1', 'input', 'media', 'clip.mov'));
});

test('rejects missing media without moving or creating a task', async () => {
  const f = await fixture(manifest, {}); const r = relay();
  const results = await scanOnce({ inboxDir: f.root, runsDir: f.runs, relay: r });
  assert.equal(results[0].status, 'rejected'); assert.equal(r.created.length, 0); await stat(f.source);
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
  const original = r.createTask; r.createTask = async () => { throw new Error('simulated crash window'); };
  await assert.rejects(processSubmission(f.source, { runsDir: f.runs, relay: r, now }));
  r.createTask = original;
  const recovered = await scanOnce({ inboxDir: f.root, runsDir: f.runs, relay: r, now });
  assert.equal(recovered[0].status, 'task-created'); assert.equal(r.created.length, 1);
  const again = await scanOnce({ inboxDir: f.root, runsDir: f.runs, relay: r, now });
  assert.equal(again[0].status, 'already-tasked'); assert.equal(r.created.length, 1);
  const hour = String(now.getHours()).padStart(2, '0');
  const movedManifest = path.join(f.runs, '2026-09-27', hour, 'submission-1', 'input', 'manifest.json');
  assert.equal(await readFile(movedManifest, 'utf8') !== '', true);
});
