import test from 'node:test';
import assert from 'node:assert/strict';
import { createGateway } from '../core/service.mjs';
import { fixture, fakeNotifier, job, timestamp } from './helpers.mjs';
import { resolveConfig } from '../core/config.mjs';

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
  const makeSubscriber = ({ onEvent }) => {
    receiveEvent = onEvent;
    return { start() {}, async stop() {}, status: () => ({ connected: true, lastError: null }) };
  };
  const config = { ...resolveConfig(), stateDir: dir, port: 0, settleMs: 0,
    deliveryTickMs: 300_000, reconcileIntervalMs: 300_000 };
  const gateway = await createGateway({ config, notifier, dashboard, now: clock.now,
    makeSubscriber, log: () => {} });
  await gateway.start();
  t.after(() => gateway.stop());
  assert.equal(gateway.health().status, 'ok');
  assert.equal(gateway.ledger.counts().baseline, 9);
  assert.equal(notifier.sends.length, 0);
  const port = gateway.server.server.address().port;

  const initialized = await rpc(port, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } });
  assert.equal(initialized.result.serverInfo.name, 'chat-gateway');
  const list = await rpc(port, 'tools/list');
  assert.deepEqual(list.result.tools.map((tool) => tool.name), ['chat_report', 'chat_env']);
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
  const invalid = await rpc(port, 'tools/call', { name: 'chat_report', arguments: { text: '' } });
  assert.equal(invalid.result.isError, true);

  await gateway.stop();
  const restarted = await createGateway({ config, dashboard, notifier, now: clock.now,
    makeSubscriber, log: () => {} });
  await restarted.start();
  await restarted.delivery.tick();
  assert.equal(notifier.sends.length, 2);
  assert.equal(restarted.ledger.counts().delivered, 2);
  await restarted.stop();
});
