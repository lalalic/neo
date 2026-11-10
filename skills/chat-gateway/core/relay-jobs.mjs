import { isTerminalStatus } from './job-status.mjs';

export const JOB_ID_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;
export const REPOSITORY_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,36}[A-Za-z0-9])?\/[A-Za-z0-9._-]{1,100}$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const clip = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');

export function normalizeJobId(value) {
  const id = Number.isSafeInteger(value) ? String(value) : value;
  return typeof id === 'string' && JOB_ID_PATTERN.test(id) ? id : null;
}

export function normalizeRepository(value) {
  return typeof value === 'string' && REPOSITORY_PATTERN.test(value) ? value : null;
}

export function normalizeIsoDateTime(value) {
  const timestamp = clip(value, 40);
  if (!ISO_DATE_PATTERN.test(timestamp) || !Number.isFinite(Date.parse(timestamp))) return null;
  const date = timestamp.slice(0, 10);
  return new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date ? timestamp : null;
}

function normalizeStatus(row) {
  const status = isTerminalStatus(row.state) ? row.state : (row.runtimeStatus || row.state);
  return typeof status === 'string' && /^[A-Z_]{2,40}$/.test(status) ? status : null;
}

export function normalizeJob(row, { jobId, repository, includeState = false } = {}) {
  if (!row || typeof row !== 'object') return null;
  const id = normalizeJobId(row.id);
  if (!id || (jobId !== undefined && id !== jobId)) return null;
  const jobRepository = normalizeRepository(row.repository);
  if (!jobRepository || (repository !== undefined && jobRepository !== repository)) return null;
  const status = normalizeStatus(row);
  if (!status) return null;
  const jobState = typeof row.state === 'string' && /^[A-Z_]{2,40}$/.test(row.state) ? row.state : null;
  if (includeState && !jobState) return null;
  const createdAt = normalizeIsoDateTime(row.createdAt);
  if (!createdAt) return null;
  const normalized = {
    id,
    repository: jobRepository,
    status,
    createdAt,
    updatedAt: normalizeIsoDateTime(row.updatedAt) ?? '',
    ...(includeState ? { jobState } : {}),
  };
  const title = clip(row.title, 120);
  if (title) normalized.title = title;
  return normalized;
}

export function normalizeJobs(payload) {
  const rows = Array.isArray(payload?.jobs) ? payload.jobs : [];
  const jobs = [];
  for (const row of rows) {
    const job = normalizeJob(row);
    if (job && job.createdAt) jobs.push(job);
  }
  return jobs;
}

function normalizeEventIdentity(value) {
  return typeof value === 'string' && JOB_ID_PATTERN.test(value) ? value : null;
}

function eventLabel(type, status) {
  if (type === 'job.created') return 'Job created';
  if (type === 'planner.started') return 'Planning started';
  if (type === 'planner.completed') return 'Planning completed';
  if (type === 'job.runtime_status.changed') return `Runtime ${status.toLowerCase()}`;
  if (type === 'task.created') return 'Task created';
  if (type === 'task.queued') return 'Task queued';
  if (type === 'task.dispatch') return 'Task dispatched';
  if (type === 'task.started' || type === 'task.process.launched') return 'Task running';
  if (type === 'task.progress') return 'Task progress';
  if (type === 'task.release') return 'Task released';
  if (type === 'review.created' || type === 'review.requested') return 'Review requested';
  if (type === 'review.started') return 'Review running';
  if (type === 'review.blocked') return 'Review blocked';
  if (type === 'review.approved') return 'Review approved';
  if (type === 'review.changes_required') return 'Review changes required';
  if (type === 'task.completed' || type === 'task.succeeded' || type === 'job.completed') return 'Completed';
  if (type === 'task.failed') return 'Task failed';
  if (type === 'job.failed') return 'Job failed';
  if (type === 'task.cancelled' || type === 'job.cancelled') return 'Cancelled';
  return 'Lifecycle update';
}

const EVENT_STATUS = Object.freeze({
  'job.created': 'CREATED',
  'planner.started': 'PLANNING',
  'planner.completed': 'PLANNED',
  'job.runtime_status.changed': 'LIFECYCLE',
  'task.created': 'CREATED',
  'task.queued': 'QUEUED',
  'task.dispatch': 'DISPATCHED',
  'task.started': 'RUNNING',
  'task.process.launched': 'RUNNING',
  'task.progress': 'PROGRESS',
  'task.release': 'RELEASED',
  'review.created': 'REVIEW_REQUESTED',
  'review.requested': 'REVIEW_REQUESTED',
  'review.started': 'REVIEWING',
  'review.approved': 'REVIEW_APPROVED',
  'review.changes_required': 'REVIEW_CHANGES_REQUIRED',
  'review.blocked': 'REVIEW_BLOCKED',
  'task.completed': 'COMPLETED',
  'task.succeeded': 'COMPLETED',
  'task.failed': 'FAILED',
  'task.cancelled': 'CANCELLED',
  'job.completed': 'COMPLETED',
  'job.failed': 'FAILED',
  'job.cancelled': 'CANCELLED',
});

export function normalizeRelayEvents(payload, { jobId } = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
      normalizeJobId(payload.job_id) !== (jobId ?? null) ||
      payload.order !== 'asc' || !Array.isArray(payload.events) ||
      !Number.isSafeInteger(payload.next_cursor)) return null;
  if (payload.events.length > 0 && payload.events.at(-1)?.cursor !== payload.next_cursor) return null;
  const rows = [];
  let previous = 0;
  for (const row of payload.events) {
    const cursor = row?.cursor;
    const event = row?.event;
    if (!Number.isSafeInteger(cursor) || cursor <= 0 || cursor <= previous ||
        normalizeJobId(event?.job_id) !== jobId || typeof event.type !== 'string') return null;
    previous = cursor;
    const timestamp = normalizeIsoDateTime(event.timestamp);
    if (!timestamp || !EVENT_STATUS[event.type]) continue;
    const taskId = normalizeEventIdentity(event.task_id);
    let status = EVENT_STATUS[event.type];
    if (event.type === 'job.runtime_status.changed') {
      const to = event.data?.to;
      if (typeof to !== 'string' || !/^[A-Z_]{2,40}$/.test(to)) continue;
      status = to;
    }
    rows.push({
      type: event.type,
      status,
      label: eventLabel(event.type, status),
      timestamp,
      ...(taskId ? { taskId } : {}),
    });
  }
  return { rows, count: payload.events.length, nextCursor: payload.next_cursor };
}

export function createRelayEventHistoryClient({ apiUrl, fetcher = fetch, timeoutMs = 12_000, maxEvents = 100, maxPages = 5 }) {
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(apiUrl)) {
    throw new Error('Events history URL must be an http loopback URL');
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new Error('Invalid event history timeout');
  }
  return {
    async fetchEvents(jobId) {
      const rows = [];
      let after = 0;
      let truncated = false;
      for (let page = 0; page < maxPages; page += 1) {
        const url = new URL('/events', apiUrl);
        url.searchParams.set('job', jobId);
        url.searchParams.set('limit', '60');
        url.searchParams.set('order', 'asc');
        url.searchParams.set('after', String(after));
        let response;
        try {
          response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
        } catch (error) {
          throw new Error(`Relay activity source unavailable: ${error?.code ?? error?.name ?? 'request failed'}`);
        }
        if (!response.ok) throw new Error(`Relay activity source unavailable: HTTP ${response.status}`);
        const page = normalizeRelayEvents(await response.json(), { jobId });
        if (!page) throw new Error('Relay activity source returned invalid data');
        if ((page.count === 0 && page.nextCursor !== after) ||
            (page.count > 0 && page.nextCursor <= after)) {
          throw new Error('Relay activity source returned a non-advancing cursor');
        }
        rows.push(...page.rows);
        after = page.nextCursor;
        if (rows.length > maxEvents) {
          return { events: rows.slice(0, maxEvents), truncated: true };
        }
        if (page.count === 0) {
          return { events: rows, truncated: false };
        }
        if (page.count < 60) {
          return { events: rows, truncated: false };
        }
      }
      truncated = true;
      return { events: rows.slice(0, maxEvents), truncated };
    },
  };
}

export function createDashboardClient({ baseUrl, fetcher = fetch, timeoutMs = 20_000 }) {
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(baseUrl)) {
    throw new Error('Dashboard URL must be an http loopback URL');
  }
  const request = async (url, options) => {
    let response;
    try {
      response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(timeoutMs), ...options });
    } catch (error) {
      throw new Error(`Relay dashboard unavailable: ${error?.code ?? error?.name ?? 'request failed'}`);
    }
    if (!response.ok) throw new Error(`Relay dashboard request failed: HTTP ${response.status}`);
    return response.json();
  };
  return {
    async fetchJobs() {
      return normalizeJobs(await request(`${baseUrl}/api/jobs?inventory=1`));
    },
    async fetchJob(jobId, repository) {
      if (!normalizeJobId(jobId) || !normalizeRepository(repository)) throw new Error('Invalid job identity');
      const params = new URLSearchParams({ id: jobId, repo: repository });
      const job = normalizeJob(await request(`${baseUrl}/api/job?${params}`),
        { jobId, repository, includeState: true });
      if (!job) throw new Error('Job not found');
      return job;
    },
    async requestCancellation(jobId, repository) {
      if (!normalizeJobId(jobId) || !normalizeRepository(repository)) throw new Error('Invalid job identity');
      const params = new URLSearchParams({ id: jobId, state: 'CANCELLED', repo: repository });
      const job = normalizeJob(await request(`${baseUrl}/api/job-state?${params}`, { method: 'POST' }),
        { jobId, repository, includeState: true });
      if (!job) throw new Error('Job not found');
      return job;
    },
  };
}
