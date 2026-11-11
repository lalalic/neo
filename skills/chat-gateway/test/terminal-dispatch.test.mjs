import test from 'node:test';
import assert from 'node:assert/strict';
import { createTerminalDispatcher } from '../core/terminal-dispatch.mjs';
import { createChat } from '../core/chat.mjs';
import { files } from '../core/files.mjs';
import { fixture, timestamp } from './helpers.mjs';

async function queueJob(ledger, clock, id, status = 'COMPLETED') {
  const key = `job:${id}:${status}:${timestamp()}`;
  await ledger.put({
    key, kind: 'job', status: 'pending', jobId: id, to: status,
    terminalUpdatedAt: timestamp(), title: `Job ${id}`, repository: 'demo/neo',
    createdAt: new Date(clock.now()).toISOString(), attempts: 0, nextAttemptAt: 0,
  });
  return key;
}

test('dispatcher queues only for a bound head and deduplicates after restart', async (t) => {
  const { dir, clock, ledger } = await fixture(t);
  const requests = [];
  const chat = createChat({ files, dir, ledger, now: clock.now, submit: async () => {} });
  const submit = async (req) => { requests.push(req); return { status: 'submitted' }; };
  const key = await queueJob(ledger, clock, '903');
  let dispatch = createTerminalDispatcher({ ledger, chat, submit, now: clock.now });
  await dispatch.tick();
  assert.equal(requests.length, 0);
  assert.equal(ledger.get(key).status, 'pending');

  await chat.bindSystem({ projectId: 'g-p-abcdefghijkl', threadId: 'thread-abcdefgh' });
  await Promise.all([dispatch.tick(), dispatch.tick()]);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].projectId, 'g-p-abcdefghijkl');
  assert.equal(requests[0].threadId, 'thread-abcdefgh');
  assert.match(requests[0].text, /jobId/);
  assert.match(requests[0].text, /mcp.chat-gateway chat_report/);
  assert.equal(ledger.get(key).status, 'submitted');
  dispatch = createTerminalDispatcher({ ledger, chat, submit, now: clock.now });
  await dispatch.tick();
  assert.equal(requests.length, 1, 'no replay of an accepted turn');
});

test('transient submission failure retries the same turn with backoff and stable identity', async (t) => {
  const { dir, clock, ledger } = await fixture(t);
  const chat = createChat({ files, dir, ledger, now: clock.now, submit: async () => {} });
  await chat.bind({ threadId: 'thread-123456789' });
  const key = await queueJob(ledger, clock, '904', 'CANCELLED');
  const sent = [];
  const dispatch = createTerminalDispatcher({
    ledger, chat, now: clock.now, log: () => {},
    submit: async (req) => {
      sent.push(req);
      if (sent.length === 1) throw Error('transient transport failure');
      return { status: 'submitted' };
    },
  });
  await dispatch.tick();
  assert.equal(ledger.get(key).status, 'pending');
  assert.equal(ledger.get(key).nextAttemptAt, clock.now() + 5000);
  await dispatch.tick();
  assert.equal(sent.length, 1);
  clock.advance(5000);
  await dispatch.tick();
  assert.equal(sent.length, 2);
  assert.equal(sent[0].requestId, sent[1].requestId);
  assert.equal(sent[0].text, sent[1].text);
  assert.match(sent[1].text, /cancellation/);
  assert.equal(ledger.get(key).status, 'submitted');
});

test('dispatcher preserves bounded batches and backlog until further passes', async (t) => {
  const { dir, clock, ledger } = await fixture(t);
  const chat = createChat({ files, dir, ledger, now: clock.now, submit: async () => {} });
  await chat.bind({ threadId: 'thread-123456789' });
  for (let i = 0; i < 5; i++) await queueJob(ledger, clock, String(910 + i));
  const sent = [];
  const dispatch = createTerminalDispatcher({ ledger, chat,
    submit: async req => { sent.push(req); }, batchSize: 2, now: clock.now });
  await dispatch.tick();
  assert.equal(sent.length, 2);
  assert.equal(dispatch.status().pending, 3);
  await dispatch.tick();
  await dispatch.tick();
  assert.equal(sent.length, 5);
  assert.equal(dispatch.status().pending, 0);
});

test('first dispatcher attempt ignores legacy push notification retry backoff', async (t) => {
  const { dir, clock, ledger } = await fixture(t);
  const chat = createChat({ files, dir, ledger, now: clock.now, submit: async () => {} });
  await chat.bind({ threadId: 'thread-123456789' });
  const key = await queueJob(ledger, clock, '915');
  await ledger.put({
    ...ledger.get(key), attempts: 26, nextAttemptAt: clock.now() + 3_600_000,
    lastError: 'retired phone notification transport timeout',
  });
  const requests = [];
  const dispatch = createTerminalDispatcher({
    ledger, chat, now: clock.now,
    submit: async req => { requests.push(req); throw Error('temporary WebHelm transport failure'); },
  });
  await dispatch.tick();
  assert.equal(requests.length, 1, 'legacy push backoff must not delay the initial turn');
  assert.equal(ledger.get(key).attempts, 1, 'turn retry counter starts independently');
  assert.equal(ledger.get(key).nextAttemptAt, clock.now() + 5000);
});
