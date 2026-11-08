import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLedger } from '../core/ledger.mjs';
import { files } from '../core/files.mjs';
import { createTracker } from '../core/tracker.mjs';

export const timestamp = (minute = 0) => new Date(Date.UTC(2026, 10, 8, 19, minute)).toISOString();
export const job = (id, status = 'ACTIVE', updatedAt = timestamp()) => ({
  id: String(id), status, title: `Job ${id}`, repository: 'example/neo', updatedAt,
});

export function clock(start = Date.parse(timestamp())) {
  let time = start;
  return { now: () => time, advance: (delta) => { time += delta; }, set: (value) => { time = value; } };
}

export async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'chat-gateway-test-'));
  t.after(() => rm(dir, { force: true, recursive: true }));
  const c = clock();
  const ledger = await openLedger({ dir, now: c.now });
  const tracker = createTracker({ ledger, snapshotFile: join(dir, 'snapshot.json'), files, now: c.now });
  await tracker.load();
  return { dir, clock: c, ledger, tracker };
}

export function fakeNotifier() {
  const sends = [];
  let reject = false;
  return {
    sends,
    fail(value) { reject = value; },
    async send(input) {
      sends.push(input);
      if (reject) throw new Error('temporary notification outage');
      return { ok: true, deliveryId: `ack-${sends.length}` };
    },
    async probe() { return { reachable: true, policy: { completed: true } }; },
  };
}
