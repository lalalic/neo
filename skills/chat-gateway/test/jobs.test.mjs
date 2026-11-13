import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeJobs, createDashboardClient } from '../core/dashboard.mjs';
import { createGateway } from '../core/service.mjs';
import { fixture, fakeNotifier, resolveTestConfig } from './helpers.mjs';

test('Jobs feed contains running and finished jobs but strips confidential dashboard fields', async () => {
  const dashboard = createDashboardClient({
    baseUrl: 'http://127.0.0.1:8787',
    fetcher: async () => Response.json({ jobs: [
      { id: '23', title: 'Vlog verification', repository: 'vlog',
        runtimeStatus: 'RUNNING', state: 'ACTIVE', updatedAt: '2026-11-08T21:01:00Z',
        createdAt: '2026-11-08T21:00:00Z',
        prompt: 'private owner request', objective: 'secret', repoPath: '/Users/secret' },
      { id: '24', title: 'Video render', repository: 'vlog',
        state: 'COMPLETED', updatedAt: '2026-11-08T21:02:00Z',
        createdAt: '2026-11-08T21:01:30Z' },
    ] }),
  });
  const jobs = await dashboard.fetchJobs();
  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].status, 'RUNNING');
  assert.equal(jobs[1].status, 'COMPLETED');
  assert.equal(jobs[0].cancellable, true);
  assert.equal(jobs[1].cancellable, false);
  for (const job of jobs) assert.deepEqual(
    Object.keys(job).sort(),
    ['cancellable', 'createdAt', 'id', 'repository', 'status', 'title', 'updatedAt'],
  );
  assert.ok(!JSON.stringify(jobs).includes('secret'));
  assert.ok(!JSON.stringify(jobs).includes('private owner'));
});

test('Job normalization rejects malformed entries', () => {
  const jobs = normalizeJobs({ jobs: [null, {}, { id: '../x', state: 'RUNNING' },
    { id: 13, state: 'ACTIVE', runtimeStatus: 'WAITING', title: 'Valid',
      createdAt: 'not-a-timestamp', updatedAt: '2026-11-08T21:02:00Z' },
    { id: 14, state: 'ACTIVE', runtimeStatus: 'WAITING', title: 'Valid', repository: 'vlog',
      createdAt: '2026-11-08T21:02:00Z', updatedAt: '2026-11-08T21:02:00Z' }] });
  assert.deepEqual(jobs, [{ id: '14', title: 'Valid', repository: 'vlog',
    status: 'WAITING', cancellable: true, createdAt: '2026-11-08T21:02:00Z', updatedAt: '2026-11-08T21:02:00Z' }]);
});


test('authenticated MCP chat_jobs keeps current Relay local repo rows for Neo Mobile', async (t) => {
  const { dir, clock } = await fixture(t);
  const rows = [
    { id: '625', repository: 'content-distribution', title: 'Content Distribution',
      state: 'COMPLETED', createdAt: '2026-11-12T20:53:55.691Z',
      updatedAt: '2026-11-12T20:59:02.990Z', objective: '/private/secret' },
    { id: '619', repository: 'vlog', title: 'Vlog',
      state: 'COMPLETED', createdAt: '2026-11-12T09:40:17.988Z',
      updatedAt: '2026-11-12T14:09:30.229Z', objective: 'secret user prompt' },
  ];
  const gateway = await createGateway({
    config: resolveTestConfig(dir),
    dashboard: { fetchJobs: async () => normalizeJobs({ jobs: rows }) },
    notifier: fakeNotifier(), now: clock.now, log: () => {},
    makeSubscriber: () => ({ start() {}, async stop() {},
      status: () => ({ connected: true, lastError: null }) }),
  });
  await gateway.start();
  t.after(() => gateway.stop());
  const port = gateway.server.server.address().port;
  const reply = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'chat_jobs', arguments: { limit: 10 } } }),
  });
  const body = (await reply.json()).result.structuredContent;
  assert.equal(body.total, 2);
  assert.deepEqual(body.jobs.map(x => [x.id, x.repository]),
    [['625', 'content-distribution'], ['619', 'vlog']]);
  assert.ok(!JSON.stringify(body).includes('secret'));
  assert.ok(!JSON.stringify(body).includes('/private'));
});


test('chat_jobs pages 20 at a time, uses stable active-first ordering and reports exhaustion', async (t) => {
  const { dir, clock } = await fixture(t);
  const rows = Array.from({ length: 47 }, (_, i) => ({ id: String(i + 1),
    repository: 'vlog', title: `Job ${i + 1}`,
    state: i === 0 ? 'ACTIVE' : 'COMPLETED',
    runtimeStatus: i === 0 ? 'WAITING' : 'COMPLETED',
    createdAt: '2026-11-12T20:53:55.691Z',
    updatedAt: new Date(Date.parse('2026-11-12T21:00:00Z') - i * 1000).toISOString(),
  }));
  const gateway = await createGateway({
    config: resolveTestConfig(dir),
    dashboard: { fetchJobs: async () => normalizeJobs({ jobs: rows }) },
    notifier: fakeNotifier(), now: clock.now, log: () => {},
    makeSubscriber: () => ({ start() {}, async stop() {},
      status: () => ({ connected: true, lastError: null }) }),
  });
  await gateway.start();
  t.after(() => gateway.stop());
  const url = `http://127.0.0.1:${gateway.server.server.address().port}/mcp`;
  const call = async args => {
    const response = await fetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name: 'chat_jobs', arguments: args } }),
    });
    return (await response.json()).result;
  };
  const p1 = (await call({})).structuredContent;
  const p2 = (await call({ limit: 20, offset: 20 })).structuredContent;
  const p3 = (await call({ limit: 20, offset: 40 })).structuredContent;
  assert.deepEqual([p1.jobs.length, p2.jobs.length, p3.jobs.length], [20, 20, 7]);
  assert.deepEqual([p1.nextOffset,p2.nextOffset,p3.nextOffset], [20, 40, 47]);
  assert.deepEqual([p1.hasMore,p2.hasMore,p3.hasMore], [true,true,false]);
  assert.equal(p1.jobs[0].id, '1');
  assert.equal(p1.jobs[0].status, 'WAITING');
  assert.equal(new Set([...p1.jobs,...p2.jobs,...p3.jobs].map(x => x.id)).size, 47);
  const bad = await call({ limit: 20, offset: -1 });
  assert.equal(bad.isError, true);
  assert.equal(bad.structuredContent.error.includes('offset'), true);
});
