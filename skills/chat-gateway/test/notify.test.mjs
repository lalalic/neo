import test from 'node:test';
import assert from 'node:assert/strict';
import { createDelivery } from '../core/delivery.mjs';
import { fixture, fakeNotifier } from './helpers.mjs';

async function pending(ledger, clock, key, kind = 'job') {
  await ledger.put({ kind, key, jobId: key, to: 'COMPLETED', title: key, repository: 'neo',
    text: `${key} report`, status: 'pending', attempts: 0, nextAttemptAt: 0,
    createdAt: new Date(clock.now()).toISOString() });
}

test('pending remains pending without acknowledgement; retry backs off and succeeds once', async (t) => {
  const { ledger, clock } = await fixture(t);
  const notifier = fakeNotifier();
  notifier.fail(true);
  await pending(ledger, clock, '1');
  const delivery = createDelivery({ ledger, notifier, now: clock.now, settleMs: 0 });
  await delivery.tick();
  assert.equal(ledger.pending().length, 1);
  assert.equal(ledger.get('1').attempts, 1);
  assert.equal(ledger.get('1').nextAttemptAt, clock.now() + 5000);
  await delivery.tick();
  assert.equal(notifier.sends.length, 1);
  notifier.fail(false);
  clock.advance(5000);
  await delivery.tick();
  assert.equal(notifier.sends.length, 2);
  assert.equal(ledger.get('1').status, 'delivered');
  await delivery.tick();
  assert.equal(notifier.sends.length, 2);
});

test('six terminal jobs pending in one burst coalesce into one acknowledged notification', async (t) => {
  const { ledger, clock } = await fixture(t);
  const notifier = fakeNotifier();
  for (let i = 0; i < 6; i += 1) await pending(ledger, clock, String(i));
  const delivery = createDelivery({ ledger, notifier, now: clock.now, settleMs: 0 });
  await delivery.tick();
  assert.equal(notifier.sends.length, 1);
  assert.match(notifier.sends[0].title, /6 jobs/);
  assert.equal(ledger.pending().length, 0);
  assert.equal(ledger.counts().delivered, 6);
});

test('attention notifications are leading-edge coalesced for 60s, including restart', async (t) => {
  const { ledger, clock } = await fixture(t);
  const notifier = fakeNotifier();
  await pending(ledger, clock, 'r1', 'report');
  const delivery = createDelivery({ ledger, notifier, now: clock.now, settleMs: 0 });
  await delivery.tick();
  assert.equal(notifier.sends.length, 1);
  clock.advance(1000);
  await pending(ledger, clock, 'r2', 'report');
  const afterRestart = createDelivery({ ledger, notifier, now: clock.now, settleMs: 0 });
  await afterRestart.tick();
  assert.equal(notifier.sends.length, 1);
  assert.equal(ledger.get('r2').status, 'coalesced');
  clock.advance(61_000);
  await pending(ledger, clock, 'r3', 'report');
  await afterRestart.tick();
  assert.equal(notifier.sends.length, 2);
  assert.equal(ledger.get('r3').status, 'delivered');
});

test('missing acknowledgement is a retryable failure', async (t) => {
  const { ledger, clock } = await fixture(t);
  await pending(ledger, clock, '1');
  const delivery = createDelivery({ ledger, now: clock.now, settleMs: 0,
    notifier: { async send() { return { ok: true }; } } });
  await delivery.tick();
  assert.equal(ledger.get('1').status, 'pending');
});
