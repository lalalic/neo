import test from 'node:test';
import assert from 'node:assert/strict';
import { createGateway } from '../core/service.mjs';
import { fixture, fakeNotifier, job, timestamp } from './helpers.mjs';
import { resolveConfig } from '../core/config.mjs';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

async function rpc(port, method, params = {}) {
  const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  assert.equal(response.status, 200);
  return response.json();
}

test('in-process E2E: startup baseline, event, reconnection, dedupe, reports and MCP tools', async (t) => {
  const { dir, clock } = await fixture(t);
  const notifier = fakeNotifier();
  let jobs = Array.from({ length: 9 }, (_, i) => job(i + 1, 'COMPLETED', timestamp(-10)));
  jobs.push(job(10, 'ACTIVE', timestamp(-10)));
  const dashboard = { fetchJobs: async () => jobs };
  let receiveEvent;
  const chatSubmissions = [];
  const makeSubscriber = ({ onEvent }) => {
    receiveEvent = onEvent;
    return { start() {}, async stop() {}, status: () => ({ connected: true, lastError: null }) };
  };
  const config = { ...resolveConfig({ env: { EVENTS_BUS_CONFIG: `${dir}/test-events-not-configured.json` } }), stateDir: dir, port: 0, settleMs: 0,
    deliveryTickMs: 300_000, reconcileIntervalMs: 300_000 };
  const gateway = await createGateway({ config, notifier, dashboard, now: clock.now,
    makeSubscriber, chatSubmit: async (request) => { chatSubmissions.push(request); return { status: 'submitted' }; }, log: () => {} });
  await gateway.start();
  t.after(() => gateway.stop());
  assert.equal(gateway.health().status, 'ok');
  assert.equal(gateway.ledger.counts().baseline, 9);
  assert.equal(notifier.sends.length, 0);
  const port = gateway.server.server.address().port;

  const initialized = await rpc(port, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } });
  assert.equal(initialized.result.serverInfo.name, 'chat-gateway');
  const list = await rpc(port, 'tools/list');
  assert.deepEqual(list.result.tools.map((tool) => tool.name), ['chat_report', 'chat_bind', 'chat_head', 'chat_send', 'chat_upload', 'chat_jobs', 'chat_job_activity', 'chat_job_cancel', 'chat_feed', 'chat_env']);
  const env = await rpc(port, 'tools/call', { name: 'chat_env', arguments: {} });
  assert.equal(env.result.structuredContent.mode, 'home');
  assert.equal(env.result.structuredContent.phone.channel, 'unknown');

  await receiveEvent({ jobId: '10', to: 'COMPLETED', updatedAt: timestamp(1), repository: 'example/neo' });
  await gateway.delivery.tick();
  assert.equal(notifier.sends.length, 1);
  assert.match(notifier.sends[0].title, /completed/);
  await receiveEvent({ jobId: '10', to: 'COMPLETED', updatedAt: timestamp(1), repository: 'example/neo' });
  jobs = jobs.map((j) => j.id === '10' ? job(10, 'COMPLETED', timestamp(1)) : j);
  await gateway.reconciler.run();
  await gateway.delivery.tick();
  assert.equal(notifier.sends.length, 1);

  const info = await rpc(port, 'tools/call', { name: 'chat_report', arguments: { text: 'Internal milestone' } });
  assert.equal(info.result.structuredContent.notificationQueued, false);
  await gateway.delivery.tick();
  assert.equal(notifier.sends.length, 1);
  const attention = await rpc(port, 'tools/call', {
    name: 'chat_report', arguments: { text: 'Owner action required', level: 'attention', needs: 'phone' },
  });
  assert.equal(attention.result.structuredContent.notificationQueued, true);
  await gateway.delivery.tick();
  assert.equal(notifier.sends.length, 2);
  const jobsResponse = await rpc(port, 'tools/call', {
    name: 'chat_jobs', arguments: { limit: 2 },
  });
  assert.equal(jobsResponse.result.structuredContent.jobs.length, 2);
  assert.equal(jobsResponse.result.structuredContent.total, 10);
  assert.deepEqual(Object.keys(jobsResponse.result.structuredContent.jobs[0]).sort(),
    ['cancellable', 'createdAt', 'id', 'repository', 'status', 'title', 'updatedAt']);
  const invalidJobs = await rpc(port, 'tools/call', {
    name: 'chat_jobs', arguments: { limit: 999 },
  });
  assert.equal(invalidJobs.result.isError, true);
  const feed = await rpc(port, 'tools/call', { name: 'chat_feed', arguments: { limit: 50 } });
  assert.ok(feed.result.structuredContent.items.some((item) => item.kind === 'report' && item.text === 'Internal milestone'));
  assert.ok(feed.result.structuredContent.items.some((item) => item.kind === 'job' && item.status === 'COMPLETED'));
  assert.ok(!feed.result.structuredContent.items.some((item) => item.kind === 'job' && item.text.includes('historical')));
  const invalidFeed = await rpc(port, 'tools/call', { name: 'chat_feed', arguments: { limit: 1001 } });
  assert.equal(invalidFeed.result.isError, true);
  const headBefore = await rpc(port, 'tools/call', { name: 'chat_head', arguments: {} });
  assert.equal(headBefore.result.structuredContent.bound, false);
  const noHead = await rpc(port, 'tools/call', { name: 'chat_send',
    arguments: { text: 'Hello', requestId: 'request-12345678' } });
  assert.equal(noHead.result.isError, true);
  const bind = await rpc(port, 'tools/call', { name: 'chat_bind',
    arguments: { threadId: 'orchestrator-thread-12345678' } });
  assert.equal(bind.result.structuredContent.bound, true);
  const send = await rpc(port, 'tools/call', { name: 'chat_send',
    arguments: { text: 'Hello from iPhone', requestId: 'request-12345678' } });
  assert.equal(send.result.structuredContent.status, 'submitted');
  assert.equal(chatSubmissions.length, 1);
  assert.equal(chatSubmissions[0].threadId, 'orchestrator-thread-12345678');
  const duplicate = await rpc(port, 'tools/call', { name: 'chat_send',
    arguments: { text: 'Hello from iPhone', requestId: 'request-12345678' } });
  assert.equal(duplicate.result.structuredContent.status, 'submitted');
  assert.equal(chatSubmissions.length, 1);
  const ownerFeed = await rpc(port, 'tools/call', { name: 'chat_feed', arguments: {} });
  assert.ok(ownerFeed.result.structuredContent.items.some((item) =>
    item.kind === 'owner' && item.status === 'submitted' && item.text === 'Hello from iPhone'));
  // Binary attachment travels through MCP chunks, protected storage and
  // chat_send to the direct WebHelm CLI file path without OCR/conversion.
  const original = Buffer.from([0, 255, 137, 80, 78, 71, 0, 12, 252]);
  const sha256 = createHash('sha256').update(original).digest('hex');
  const upload = await rpc(port, 'tools/call', { name:'chat_upload', arguments: {
    requestId:'phone-binary-12345678',attachmentId:'asset-binary-12345678',
    name:'capture.png',chunkIndex:0,chunkCount:1,
    contentBase64:original.toString('base64'),sha256,size:original.length,
  }});
  assert.equal(upload.result.structuredContent.complete,true);
  const uploadedSend = await rpc(port, 'tools/call', { name:'chat_send', arguments: {
    text:'Look at this file',requestId:'phone-binary-12345678',
    attachments:[{id:'asset-binary-12345678',name:'capture.png'}],
  }});
  assert.equal(uploadedSend.result.structuredContent.status,'submitted');
  assert.equal(chatSubmissions.length,2);
  assert.equal(chatSubmissions[1].requestId,'phone-binary-12345678');
  assert.deepEqual(await readFile(chatSubmissions[1].file[0]),original);
  const afterUploadFeed = await rpc(port,'tools/call',{name:'chat_feed',arguments:{}});
  assert.ok(afterUploadFeed.result.structuredContent.items.some(item =>
    item.kind === 'owner' && item.text.includes('capture.png')));
  const invalid = await rpc(port, 'tools/call', { name: 'chat_report', arguments: { text: '' } });
  assert.equal(invalid.result.isError, true);

  await gateway.stop();
  const restarted = await createGateway({ config, dashboard, notifier, now: clock.now,
    makeSubscriber, log: () => {} });
  await restarted.start();
  await restarted.delivery.tick();
  assert.equal(notifier.sends.length, 2);
  assert.equal(restarted.ledger.counts().delivered, 2);
  const persistedHead = await restarted.chat.head();
  assert.equal(persistedHead.threadId, 'orchestrator-thread-12345678');
  await restarted.stop();
});
