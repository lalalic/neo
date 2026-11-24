import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, readFile } from 'node:fs/promises';
import { openLedger } from '../core/ledger.mjs';
import { fixture } from './helpers.mjs';

test('ledger appends durable pending, delivered and baseline states, deduping by key after restart', async (t) => {
  const { dir, ledger, clock } = await fixture(t);
  await ledger.put({ key: 'job:1:COMPLETED:v1', kind: 'job', jobId: '1', status: 'pending', createdAt: new Date(clock.now()).toISOString() });
  await ledger.put({ key: 'job:2:COMPLETED:v2', kind: 'job', jobId: '2', status: 'baseline' });
  await ledger.put({ key: 'job:1:COMPLETED:v1', kind: 'job', jobId: '1', status: 'delivered', deliveryId: 'ack1' });
  await appendFile(ledger.file, '{"partial":');
  const recovered = await openLedger({ dir, now: clock.now });
  assert.equal(recovered.get('job:1:COMPLETED:v1').status, 'delivered');
  assert.equal(recovered.get('job:2:COMPLETED:v2').status, 'baseline');
  assert.equal(recovered.counts().pending, 0);
});

test('compaction retains pending entries while pruning old acknowledged records', async (t) => {
  const { dir, ledger, clock } = await fixture(t);
  await ledger.put({ kind: 'job', key: 'old', status: 'delivered' });
  await ledger.put({ kind: 'job', key: 'pending', status: 'pending' });
  clock.advance(10_000);
  const result = await ledger.compact({ maxAgeMs: 1000 });
  assert.deepEqual(result, { dropped: 1, kept: 1 });
  assert.equal(ledger.has('pending'), true);
  const recovered = await openLedger({ dir, now: clock.now });
  assert.equal(recovered.has('old'), false);
  assert.equal(recovered.has('pending'), true);
  assert.ok((await readFile(ledger.file, 'utf8')).includes('pending'));
});
