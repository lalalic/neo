import test from 'node:test';
import assert from 'node:assert/strict';
import { createDelivery } from '../core/delivery.mjs';
import { fixture, fakeNotifier } from './helpers.mjs';

async function pending(ledger, clock, key, kind = 'report') {
  await ledger.put({ kind, key, jobId: key, to: 'COMPLETED', title: key, repository: 'neo',
    text: `${key} report`, status: 'pending', attempts: 0, nextAttemptAt: 0,
    createdAt: new Date(clock.now()).toISOString() });
}

test('report stays pending without acknowledgement; retry backs off then succeeds once', async (t) => {
  const { ledger, clock } = await fixture(t);
  const notifier = fakeNotifier();
  notifier.fail(true);
  await pending(ledger, clock, 'r1');
  const delivery = createDelivery({ ledger, notifier, now: clock.now, settleMs: 0 });
  await delivery.tick();
  assert.equal(ledger.pending('report').length, 1);
  assert.equal(ledger.get('r1').attempts, 1);
  assert.equal(ledger.get('r1').nextAttemptAt, clock.now() + 5000);
  await delivery.tick();
  assert.equal(notifier.sends.length, 1);
  notifier.fail(false);
  clock.advance(5000);
  await delivery.tick();
  assert.equal(notifier.sends.length, 2);
  assert.equal(ledger.get('r1').status, 'delivered');
  await delivery.tick();
  assert.equal(notifier.sends.length, 2);
});

test('raw terminal events never create phone notifications', async (t) => {
  const { ledger, clock } = await fixture(t);
  const notifier = fakeNotifier();
  for (let i = 0; i < 6; i += 1) await pending(ledger, clock, String(i), 'job');
  const delivery = createDelivery({ ledger, notifier, now: clock.now, settleMs: 0 });
  await delivery.tick();
  assert.equal(notifier.sends.length, 0);
  assert.equal(ledger.pending('job').length, 6);
});

test('attention notifications coalesce for 60s, including restart', async (t) => {
  const { ledger, clock } = await fixture(t);
  const notifier = fakeNotifier();
  await pending(ledger, clock, 'r1');
  const delivery = createDelivery({ ledger, notifier, now: clock.now, settleMs: 0 });
  await delivery.tick();
  assert.equal(notifier.sends.length, 1);
  clock.advance(1000);
  await pending(ledger, clock, 'r2');
  const afterRestart = createDelivery({ ledger, notifier, now: clock.now, settleMs: 0 });
  await afterRestart.tick();
  assert.equal(notifier.sends.length, 1);
  assert.equal(ledger.get('r2').status, 'coalesced');
  clock.advance(61_000);
  await pending(ledger, clock, 'r3');
  await afterRestart.tick();
  assert.equal(notifier.sends.length, 2);
  assert.equal(ledger.get('r3').status, 'delivered');
});

test('missing report notification acknowledgement is a retryable failure', async (t) => {
  const { ledger, clock } = await fixture(t);
  await pending(ledger, clock, 'r1');
  const delivery = createDelivery({ ledger, now: clock.now, settleMs: 0,
    notifier: { async send() { return { ok: true }; } } });
  await delivery.tick();
  assert.equal(ledger.get('r1').status, 'pending');
});
