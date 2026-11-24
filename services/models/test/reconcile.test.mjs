import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, job, timestamp } from './helpers.mjs';
import { createReconciler } from '../core/reconcile.mjs';
import { createTracker } from '../core/tracker.mjs';
import { files } from '../core/files.mjs';
import { join } from 'node:path';

test('first start baselines nine historical jobs, then finds a missed event exactly once', async (t) => {
  const { ledger, tracker, clock, dir } = await fixture(t);
  let jobs = Array.from({ length: 9 }, (_, i) => job(i + 1, 'COMPLETED', timestamp(-10)));
  jobs.push(job(10, 'ACTIVE', timestamp(-10)));
  const reconciliation = createReconciler({ tracker, dashboard: { fetchJobs: async () => jobs }, now: clock.now });
  assert.deepEqual(await reconciliation.run(), { baseline: true, baselined: 9, added: 0, released: 0 });
  assert.equal(ledger.pending().length, 0);
  jobs = jobs.map((j) => j.id === '10' ? job(10, 'COMPLETED', timestamp(1)) : j);
  assert.equal((await reconciliation.run()).added, 1);
  assert.equal((await reconciliation.run()).added, 0);
  assert.equal(ledger.pending().length, 1);
  assert.equal(ledger.pending()[0].key, `job:10:COMPLETED:${timestamp(1)}`);
  const restarted = createTracker({ ledger, snapshotFile: join(dir, 'snapshot.json'), files, now: clock.now });
  await restarted.load();
  assert.equal((await restarted.observeJobs(jobs)).added, 0);
});

test('event and reconciliation share a key; job reopening uses a new timestamp', async (t) => {
  const { ledger, tracker } = await fixture(t);
  await tracker.observeJobs([job(7, 'ACTIVE', timestamp(-5))]);
  assert.equal(await tracker.observeEvent({ jobId: '7', to: 'COMPLETED', updatedAt: timestamp(1) }), true);
  assert.equal((await tracker.observeJobs([job(7, 'COMPLETED', timestamp(1))])).added, 0);
  assert.equal(ledger.pending().length, 1);
  await tracker.observeEvent({ jobId: '7', to: 'ACTIVE', updatedAt: timestamp(2) });
  await tracker.observeEvent({ jobId: '7', to: 'COMPLETED', updatedAt: timestamp(3) });
  assert.equal(ledger.pending().length, 2);
  assert.equal(await tracker.observeEvent({ jobId: '7', to: 'COMPLETED', updatedAt: timestamp(3) }), false);
});

test('dashboard failures are degraded and recover without losing state', async (t) => {
  const { tracker } = await fixture(t);
  let fail = true;
  const reconcile = createReconciler({ tracker, dashboard: { async fetchJobs() {
    if (fail) throw new Error('dashboard unavailable');
    return [job(1, 'COMPLETED')];
  } } });
  await assert.rejects(reconcile.run(), /dashboard unavailable/);
  assert.equal(reconcile.status().reachable, false);
  fail = false;
  assert.equal((await reconcile.run()).baselined, 1);
  assert.equal(reconcile.status().reachable, true);
});
