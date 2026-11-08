import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatGPTSubmitter } from '../core/chatgpt-client.mjs';
import { createChat } from '../core/chat.mjs';
import { openLedger } from '../core/ledger.mjs';
import { files } from '../core/files.mjs';
import { fixture } from './helpers.mjs';

test('ChatGPT transport accepts only explicit queued submission receipts', async () => {
  let args;
  const submit = createChatGPTSubmitter({
    endpoint: 'http://127.0.0.1:6767/mcp',
    fetcher: async (_url, options) => {
      args = JSON.parse(options.body).params.arguments;
      return { ok: true, headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ result: {
          structuredContent: { result: { status: 'submitted', mode: 'new-turn' } },
        } }) };
    },
  });
  await submit({ threadId: 'orchestrator-12345', text: 'Hello' });
  assert.equal(args.command, 'turn');
  assert.equal(args.args.thread_id, 'orchestrator-12345');
  assert.equal(args.args.mode, 'async');
  assert.equal(args.args.mergeable, false);
  assert.throws(() => createChatGPTSubmitter({ endpoint: 'https://example.org/mcp' }));
  const rejected = createChatGPTSubmitter({ endpoint: 'http://127.0.0.1:6767/mcp',
    fetcher: async () => ({ ok: true, headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ result: { structuredContent: { status: 'completed' } } }) }),
  });
  await assert.rejects(rejected({ threadId: 'valid-123456', text: 'a' }), /durable queue/);
});

test('chat binding persists privately, validates input, and failed submits never claim success', async (t) => {
  const { dir } = await fixture(t);
  const ledger = await openLedger({ dir });
  let calls = 0;
  const chat = createChat({ ledger, files, dir, submit: async () => {
    calls++; throw new Error('offline');
  } });
  await assert.rejects(chat.bind({ threadId: '../escape' }), /threadId/);
  await assert.rejects(chat.send({ text: 'a', requestId: 'owner-12345678' }), /Orchestrator is initializing/);
  await chat.bind({ threadId: 'thread-12345678' });
  await assert.rejects(chat.send({ text: 'a', requestId: 'owner-12345678' }), /offline/);
  assert.equal(calls, 1);
  assert.equal(ledger.get('owner:owner-12345678').status, 'failed');
  await assert.rejects(chat.send({ text: 'a', requestId: 'owner-12345678' }), /offline/);
  assert.equal(calls, 2, 'same requestId is retried after a confirmed failed attempt');
  assert.equal(ledger.get('owner:owner-12345678').attempts, 2);
  await assert.rejects(chat.send({ text: 'different', requestId: 'owner-12345678' }), /different message/);
  assert.equal(calls, 2, 'requestId collision must never submit different text');
  const recovered = createChat({ ledger, files, dir, submit: async () => { calls++; } });
  assert.deepEqual(await recovered.send({ text: 'a', requestId: 'owner-12345678' }), {
    id: 'owner-12345678', status: 'submitted',
  });
  assert.equal(calls, 3);
  assert.equal(ledger.get('owner:owner-12345678').status, 'submitted');
  assert.equal((await recovered.send({ text: 'a', requestId: 'owner-12345678' })).status, 'submitted');
  assert.equal(calls, 3, 'submitted request is not repeated');
  const chat2 = createChat({ ledger, files, dir, submit: async () => {} });
  assert.equal((await chat2.head()).bound, true);
  await assert.rejects(chat2.send({ text: ' ', requestId: 'new-12345678' }), /requires text/);
});
