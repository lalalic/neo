import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatGPTSubmitter } from '../core/chatgpt-client.mjs';
import { createChat } from '../core/chat.mjs';
import { openLedger } from '../core/ledger.mjs';
import { files } from '../core/files.mjs';
import { fixture } from './helpers.mjs';

test('chat transport directly executes CLI new-turn and uses a stable idempotency key', async () => {
  const { PassThrough } = await import('node:stream');
  const { readFileSync } = await import('node:fs');
  let command, args, payload;
  const submit = createChatGPTSubmitter({
    spawnProcess: (cmd, argv) => {
      command = cmd;
      args = argv;
      payload = JSON.parse(readFileSync(argv.at(-1), 'utf8'));
      const stdout = new PassThrough(), stderr = new PassThrough();
      const proc = { stdout, stderr, once(name, cb) { if (name === 'close') this.done = cb; },
        kill() {} };
      queueMicrotask(() => {
        stdout.write(JSON.stringify({ result: {ok: true,status:'submitted',mode:'new-turn',
          queue_id:'queue-123',thread_id:payload.thread_id} }) + '\n');
        proc.done?.(0, null);
      });
      return proc;
    },
  });
  const result = await submit({ threadId:'orchestrator-12345', projectId:'g-p-project-12345678',
    text:'Hello', requestId:'phone-12345678', file:['/tmp/photo.png'] });
  assert.equal(command,'webhelm');
  assert.deepEqual(args.slice(0,4), ['platform','run','chatgpt','new-turn']);
  assert.equal(payload.idempotency_key,'phone-12345678');
  assert.equal(payload.mode,'async');
  assert.equal(payload.thread_id,'orchestrator-12345');
  assert.deepEqual(payload.file,['/tmp/photo.png']);
  assert.equal(result.queueId,'queue-123');
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
