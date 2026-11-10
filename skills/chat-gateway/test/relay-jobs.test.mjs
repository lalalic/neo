import test from 'node:test';
import assertStrict from 'node:assert/strict';
import { createDashboardClient, createRelayEventHistoryClient, normalizeJob, normalizeJobs, normalizeRelayEvents } from '../core/relay-jobs.mjs';
import { createGateway } from '../core/service.mjs';
import { fixture, fakeNotifier, resolveTestConfig } from './helpers.mjs';

const response = (body, status = 200) => new Response(JSON.stringify(body), { status });

test('job normalization is typed, repository scoped, and drops synthesized timestamps', () => {
  const raw = {
    id: 21, title: 'Private title', repository: 'example/neo',
    state: 'ACTIVE', runtimeStatus: 'RUNNING', createdAt: '2026-11-10T13:42:00.461Z',
    updatedAt: '2026-11-10T13:45:00Z', objective: 'secret objective',
    projectPath: '/Users/private/project',
  };
  const job = normalizeJob(raw);
  assertStrict.deepEqual(job, {
    id: '21', title: 'Private title', repository: 'example/neo', status: 'RUNNING',
    createdAt: '2026-11-10T13:42:00.461Z', updatedAt: '2026-11-10T13:45:00Z',
  });
  assertStrict.equal(normalizeJob(raw, { jobId: '22', repository: 'example/neo' }), null);
  assertStrict.equal(normalizeJob({ ...raw, createdAt: '2026/11/10' }), null);
  assertStrict.equal(normalizeJob({ ...raw, createdAt: '2026-02-31T13:00:00Z' }), null);
  assertStrict.deepEqual(normalizeJobs({ jobs: [{ ...raw, createdAt: null }] }), []);
});

test('dashboard job readback requires exact repository identity and stays sanitized', async () => {
  const requests = [];
  const dashboard = createDashboardClient({
    baseUrl: 'http://127.0.0.1:8787',
    fetcher: async (url, options = {}) => {
      requests.push({ url: String(url), method: options.method ?? 'GET' });
      return response({ id: '31', repository: 'example/neo', state: 'ACTIVE',
        runtimeStatus: 'RUNNING', title: 'Isolated job', createdAt: '2026-11-10T13:00:00Z',
        updatedAt: '2026-11-10T13:01:00Z', objective: 'secret' });
    },
  });
  const job = await dashboard.fetchJob('31', 'example/neo');
  assertStrict.deepEqual(job, { id: '31', title: 'Isolated job', repository: 'example/neo',
    status: 'RUNNING', createdAt: '2026-11-10T13:00:00Z', updatedAt: '2026-11-10T13:01:00Z',
    jobState: 'ACTIVE' });
  assertStrict.deepEqual(requests, [{ url: 'http://127.0.0.1:8787/api/job?id=31&repo=example%2Fneo', method: 'GET' }]);
  await dashboard.requestCancellation('31', 'example/neo');
  assertStrict.deepEqual(requests[1], {
    url: 'http://127.0.0.1:8787/api/job-state?id=31&state=CANCELLED&repo=example%2Fneo', method: 'POST',
  });
});

test('event history pages oldest-first, skips unknown data, and marks a hard cap', async () => {
  const urls = [];
  const firstEvents = [
    { cursor: 1, event: { job_id: '31', task_id: '91', type: 'job.created',
      timestamp: '2026-11-10T13:00:00Z', data: { objective: 'secret' } } },
    { cursor: 2, event: { job_id: '31', task_id: '91', type: 'task.progress',
      timestamp: '2026-11-10T13:00:01Z', data: { message: '/Users/private and secret' } } },
    ...Array.from({ length: 58 }, (_, index) => ({ cursor: index + 3,
      event: { job_id: '31', type: 'unknown.private', timestamp: '2026-11-10T13:00:02Z' } })),
  ];
  const first = {
    job_id: '31', order: 'asc', next_cursor: 60,
    events: firstEvents,
  };
  const second = { job_id: '31', order: 'asc', next_cursor: 61,
    events: [{ cursor: 61, event: { job_id: '31', type: 'job.completed',
      timestamp: '2026-11-10T13:01:00Z' } }] };
  const client = createRelayEventHistoryClient({
    apiUrl: 'http://127.0.0.1:4223', maxEvents: 2, maxPages: 5,
    fetcher: async (url) => {
      urls.push(String(url));
      return urls.length === 1 ? response(first) : response(second);
    },
  });
  const result = await client.fetchEvents('31');
  assertStrict.deepEqual(result, {
    truncated: true,
    events: [
      { type: 'job.created', status: 'CREATED', label: 'Job created',
        timestamp: '2026-11-10T13:00:00Z', taskId: '91' },
      { type: 'task.progress', status: 'PROGRESS', label: 'Task progress',
        timestamp: '2026-11-10T13:00:01Z', taskId: '91' },
    ],
  });
  assertStrict.deepEqual(urls, [
    'http://127.0.0.1:4223/events?job=31&limit=60&order=asc&after=0',
    'http://127.0.0.1:4223/events?job=31&limit=60&order=asc&after=60',
  ]);
  assertStrict.deepEqual(normalizeRelayEvents({
    job_id: '31', order: 'asc', next_cursor: 0, events: [],
  }, { jobId: '31' }), { rows: [], count: 0, nextCursor: 0 });
});

test('MCP activity validates the exact job pair and hides source errors and private event data', async (t) => {
  const { dir, clock } = await fixture(t);
  let failSource = false;
  const dashboard = {
    fetchJobs: async () => [],
    fetchJob: async (jobId, repository) => {
      assertStrict.equal(jobId, '61');
      assertStrict.equal(repository, 'example/neo');
      return { id: jobId, repository, status: 'RUNNING', jobState: 'ACTIVE',
        createdAt: '2026-11-10T13:00:00Z', updatedAt: '2026-11-10T13:01:00Z' };
    },
  };
  const eventHistory = {
    fetchEvents: async (jobId) => {
      assertStrict.equal(jobId, '61');
      if (failSource) throw new Error('/private/path secret details');
      return { events: [{ type: 'task.progress', status: 'PROGRESS', label: 'Task progress',
        timestamp: '2026-11-10T13:02:00Z', taskId: '71' }], truncated: false };
    },
  };
  const gateway = await createGateway({ config: resolveTestConfig(dir), dashboard, eventHistory,
    notifier: fakeNotifier(), now: clock.now,
    makeSubscriber: () => ({ start() {}, async stop() {}, status: () => ({ connected: true, lastError: null }) }),
    log: () => {} });
  await gateway.start();
  t.after(() => gateway.stop());
  const port = gateway.server.server.address().port;
  const call = async () => {
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name: 'chat_job_activity', arguments: { repository: 'example/neo', jobId: '61' } } }),
    });
    return response.json();
  };
  const result = await call();
  assertStrict.deepEqual(result.result.structuredContent, {
    jobId: '61', repository: 'example/neo', source: 'events-bus-history',
    events: [{ type: 'task.progress', status: 'PROGRESS', label: 'Task progress',
      timestamp: '2026-11-10T13:02:00Z', taskId: '71' }], truncated: false,
  });
  failSource = true;
  const unavailable = await call();
  assertStrict.deepEqual(unavailable.result.structuredContent, { error: 'Relay activity source is unavailable' });
  assertStrict.equal(JSON.stringify(unavailable).includes('/private/path'), false);
});

test('MCP cancellation is repo scoped, reads final CANCELLED state, and serializes duplicates', async (t) => {
  const { dir, clock } = await fixture(t);
  let state = 'ACTIVE';
  let cancelCalls = 0;
  const fetchGates = [];
  let initialRead = true;
  let duplicateResponse = false;
  const rawJob = () => ({ id: '41', repository: 'example/neo', state,
    runtimeStatus: state === 'ACTIVE' ? 'RUNNING' : state, title: 'Isolated cancel',
    createdAt: '2026-11-10T13:00:00Z', updatedAt: '2026-11-10T13:01:00Z' });
  const dashboard = {
    fetchJobs: async () => [rawJob()],
    fetchJob: async (jobId, repository) => {
      if (jobId !== '41' || repository !== 'example/neo') throw new Error('Job not found');
      if (initialRead) {
        initialRead = false;
        await new Promise((resolve) => fetchGates.push(resolve));
      }
      return { id: jobId, repository, status: state, title: 'Isolated cancel',
        jobState: state, createdAt: '2026-11-10T13:00:00Z', updatedAt: '2026-11-10T13:01:00Z' };
    },
    requestCancellation: async (jobId, repository) => {
      cancelCalls += 1;
      if (jobId !== '41' || repository !== 'example/neo') throw new Error('Job not found');
      state = 'CANCELLED';
      return { id: jobId, repository, status: state, title: 'Isolated cancel',
        jobState: state, createdAt: '2026-11-10T13:00:00Z', updatedAt: '2026-11-10T13:01:00Z' };
    },
  };
  const notifier = fakeNotifier();
  const config = resolveTestConfig(dir);
  const gateway = await createGateway({ config, dashboard, notifier, now: clock.now,
    delay: async () => {}, makeSubscriber: () => ({ start() {}, async stop() {},
      status: () => ({ connected: true, lastError: null }) }), log: () => {} });
  await gateway.start();
  t.after(() => gateway.stop());
  const port = gateway.server.server.address().port;
  const call = async (id) => {
    const rpcResponse = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call',
        params: { name: 'chat_job_cancel', arguments: { repository: 'example/neo', jobId: '41' } } }),
    });
    const result = await rpcResponse.json();
    if (id === 2) duplicateResponse = true;
    return result;
  };
  const outcomesPromise = Promise.all([call(1), call(2)]);
  for (let tick = 0; tick < 100 && (fetchGates.length < 1 || !duplicateResponse); tick += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  fetchGates.forEach((resolve) => resolve());
  const outcomes = await outcomesPromise;
  assertStrict.equal(outcomes.some((item) => item.result?.structuredContent?.status === 'cancelled'), true);
  assertStrict.equal(outcomes.some((item) => item.result?.isError === true &&
    item.result?.structuredContent?.error === 'Cancellation is already in progress'), true);
  assertStrict.equal(cancelCalls, 1);
  assertStrict.equal(state, 'CANCELLED');
});

test('cancellation uses ACTIVE job state while runtime status is RUNNING and rejects completed work', async (t) => {
  const { dir, clock } = await fixture(t);
  let state = 'ACTIVE';
  let cancelCalls = 0;
  const dashboard = {
    fetchJobs: async () => [],
    fetchJob: async () => ({ id: '51', repository: 'example/neo', status: 'RUNNING',
      jobState: state, title: 'Running lifecycle', createdAt: '2026-11-10T13:00:00Z',
      updatedAt: '2026-11-10T13:01:00Z' }),
    requestCancellation: async () => {
      cancelCalls += 1;
      state = 'CANCELLED';
      return { id: '51', repository: 'example/neo', status: 'CANCELLED', jobState: state,
        title: 'Running lifecycle', createdAt: '2026-11-10T13:00:00Z',
        updatedAt: '2026-11-10T13:01:00Z' };
    },
  };
  const config = resolveTestConfig(dir);
  const gateway = await createGateway({ config, dashboard, notifier: fakeNotifier(), now: clock.now,
    delay: async () => {}, makeSubscriber: () => ({ start() {}, async stop() {},
      status: () => ({ connected: true, lastError: null }) }), log: () => {} });
  await gateway.start();
  t.after(() => gateway.stop());
  const port = gateway.server.server.address().port;
  const call = async (id) => {
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call',
        params: { name: 'chat_job_cancel', arguments: { repository: 'example/neo', jobId: '51' } } }),
    });
    return response.json();
  };
  const first = await call(1);
  assertStrict.equal(first.result.structuredContent.status, 'cancelled');
  assertStrict.equal(cancelCalls, 1);
  state = 'COMPLETED';
  const second = await call(2);
  assertStrict.equal(second.result.structuredContent.status, 'not_cancellable');
  assertStrict.equal(cancelCalls, 1);
});
