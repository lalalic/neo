import test from 'node:test';
import assertStrict from 'node:assert/strict';
import { createDashboardClient, createRelayEventHistoryClient, normalizeJob, normalizeJobs, normalizeJobTasks, normalizeRelayEvents } from '../core/relay-jobs.mjs';
import { fixture, fakeNotifier, resolveTestConfig } from './helpers.mjs';

const response = (body, status = 200) => new Response(JSON.stringify(body), { status });

test('job normalization is typed, repository scoped, and drops synthesized timestamps', () => {
  const raw = {
    id: 21, title: 'Private title', repository: 'vlog',
    state: 'ACTIVE', runtimeStatus: 'RUNNING', createdAt: '2026-11-10T13:42:00.461Z',
    updatedAt: '2026-11-10T13:45:00Z', objective: 'secret objective',
    projectPath: '/Users/private/project',
  };
  const job = normalizeJob(raw);
  assertStrict.deepEqual(job, {
    id: '21', title: 'Private title', repository: 'vlog', status: 'RUNNING',
    createdAt: '2026-11-10T13:42:00.461Z', updatedAt: '2026-11-10T13:45:00Z',
    cancellable: true,
  });
  assertStrict.equal(normalizeJob(raw, { jobId: '22', repository: 'vlog' }), null);
  assertStrict.equal(normalizeJob({ ...raw, createdAt: '2026/11/10' }), null);
  assertStrict.equal(normalizeJob({ ...raw, createdAt: '2026-02-31T13:00:00Z' }), null);
  assertStrict.deepEqual(normalizeJobs({ jobs: [{ ...raw, createdAt: null }] }), []);
});

test('Relay local repository slugs survive Jobs normalization and reject legacy remote paths', () => {
  const sample = (id, repository) => ({ id, repository, title: 'Public title',
    state: 'COMPLETED', runtimeStatus: 'COMPLETED',
    createdAt: '2026-11-12T20:53:55.691Z', updatedAt: '2026-11-12T20:59:02.990Z',
    objective: 'private', projectRoot: '/private/path' });
  const normalized = normalizeJobs({ jobs: [sample('625', 'content-distribution'),
    sample('619', 'vlog'), sample('617', 'agents-relay'), sample('611', 'lalalic/neo'),
    sample('614', '../secret'), sample('615', '')] });
  assertStrict.deepEqual(normalized.map(j => [j.id, j.repository]), [
    ['625', 'content-distribution'], ['619', 'vlog'], ['617', 'agents-relay']]);
  assertStrict.equal(JSON.stringify(normalized).includes('/private/path'), false);
  assertStrict.equal(JSON.stringify(normalized).includes('private'), false);
});

test('dashboard job readback requires exact repository identity and stays sanitized', async () => {
  const requests = [];
  const dashboard = createDashboardClient({
    baseUrl: 'http://127.0.0.1:8787',
    fetcher: async (url, options = {}) => {
      requests.push({ url: String(url), method: options.method ?? 'GET' });
      return response({ id: '31', repository: 'vlog', state: 'ACTIVE',
        runtimeStatus: 'RUNNING', title: 'Isolated job', createdAt: '2026-11-10T13:00:00Z',
        updatedAt: '2026-11-10T13:01:00Z', objective: 'secret' });
    },
  });
  const job = await dashboard.fetchJob('31', 'vlog');
  assertStrict.deepEqual(job, { id: '31', title: 'Isolated job', repository: 'vlog',
    status: 'RUNNING', createdAt: '2026-11-10T13:00:00Z', updatedAt: '2026-11-10T13:01:00Z',
    jobState: 'ACTIVE', cancellable: true });
  assertStrict.deepEqual(requests, [{ url: 'http://127.0.0.1:8787/api/job?id=31&repo=vlog', method: 'GET' }]);
  await dashboard.requestCancellation('31', 'vlog');
  assertStrict.deepEqual(requests[1], {
    url: 'http://127.0.0.1:8787/api/job-state?id=31&state=CANCELLED&repo=vlog', method: 'POST',
  });
});

test('job.blocked activity preserves the terminal lifecycle without source text', () => {
  const payload = { job_id: '31', order: 'asc', next_cursor: 1, events: [
    { cursor: 1, event: { job_id: '31', type: 'job.blocked', timestamp: '2026-11-10T13:00:00Z', data: { reason: '/private/secret' } } },
  ] };
  const result = normalizeRelayEvents(payload, { jobId: '31' });
  assertStrict.deepEqual(result.rows, [{ type: 'job.blocked', status: 'BLOCKED', label: 'Job blocked', timestamp: '2026-11-10T13:00:00Z' }]);
  assertStrict.ok(!JSON.stringify(result).includes('/private/secret'));
});

test('progress and completion send owner-safe actual text without event internals', () => {
  const payload = { job_id: '658', order: 'asc', next_cursor: 4, events: [
    { cursor: 1, event: { job_id: '658', task_id: '1943', type: 'task.progress',
      timestamp: '2026-11-17T11:12:00Z',
      message: 'task.progress', data: {
        message: 'Compared six views; calibration passed and verified.' },
      objective: 'private prompt', output: '/private/result' } },
    { cursor: 2, event: { job_id: '658', task_id: '1941', type: 'task.completed',
      timestamp: '2026-11-17T11:01:00Z',
      message: 'task.completed', data: { summary: 'Rendered preview and verified eyes.' } } },
    { cursor: 3, event: { job_id: '658', task_id: '1943', type: 'task.started',
      timestamp: '2026-11-17T11:02:00Z', message: 'Script Worker started' } },
    { cursor: 4, event: { job_id: '658', task_id: '1943', type: 'task.progress',
      timestamp: '2026-11-17T11:13:00Z', data: { message:
        'Checked /Users/worker/private.json at https://internal.example and token=ABC123 secret' } } },
  ] };
  const rows = normalizeRelayEvents(payload, { jobId: '658' }).rows;
  assertStrict.equal(rows[0].content, 'Compared six views; calibration passed and verified.');
  assertStrict.equal(rows[1].content, 'Rendered preview and verified eyes.');
  assertStrict.equal(rows[2].content, undefined, 'generic worker event uses Task title in mobile');
  assertStrict.match(rows[3].content, /Checked \[path\]/);
  const exposed = JSON.stringify(rows);
  for (const sensitive of ['private.json', 'internal.example', 'ABC123', 'private prompt', 'objective']) {
    assertStrict.ok(!exposed.includes(sensitive), sensitive);
  }
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
        timestamp: '2026-11-10T13:00:01Z', taskId: '91', content: '[path] and [redacted]' },
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
