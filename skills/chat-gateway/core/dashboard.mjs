import { isTerminalStatus } from './job-status.mjs';

const clip = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');

/**
 * Reduce the dashboard `/api/jobs` payload to the few fields this service needs.
 * `state` COMPLETED/CANCELLED is authoritative; otherwise the runtime status is used.
 * Objectives, descriptions and paths are deliberately dropped here.
 */
export function normalizeJobs(payload) {
  const rows = Array.isArray(payload?.jobs) ? payload.jobs : [];
  const jobs = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const id = Number.isSafeInteger(row.id) ? String(row.id) : row.id;
    if (typeof id !== 'string' || !/^[A-Za-z0-9_.-]{1,64}$/.test(id)) continue;
    const status = isTerminalStatus(row.state) ? row.state : (row.runtimeStatus || row.state);
    if (typeof status !== 'string' || !status) continue;
    jobs.push({
      id,
      title: clip(row.title, 120),
      repository: clip(row.repository, 120),
      status,
      updatedAt: clip(row.updatedAt, 40),
    });
  }
  return jobs;
}

export function createDashboardClient({ baseUrl, fetcher = fetch, timeoutMs = 20_000 }) {
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(baseUrl)) {
    throw new Error('Dashboard URL must be an http loopback URL');
  }
  return {
    async fetchJobs() {
      const response = await fetcher(`${baseUrl}/api/jobs`, {
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error(`Dashboard HTTP ${response.status}`);
      return normalizeJobs(await response.json());
    },
  };
}
