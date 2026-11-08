import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeJobs, createDashboardClient } from '../core/dashboard.mjs';

test('Jobs feed contains running and finished jobs but strips confidential dashboard fields', async () => {
  const dashboard = createDashboardClient({
    baseUrl: 'http://127.0.0.1:8787',
    fetcher: async () => Response.json({ jobs: [
      { id: '23', title: 'Vlog verification', repository: 'lalalic/neo',
        runtimeStatus: 'RUNNING', state: 'ACTIVE', updatedAt: '2026-11-08T21:01:00Z',
        prompt: 'private owner request', objective: 'secret', repoPath: '/Users/secret' },
      { id: '24', title: 'Video render', repository: 'lalalic/neo',
        state: 'COMPLETED', updatedAt: '2026-11-08T21:02:00Z' },
    ] }),
  });
  const jobs = await dashboard.fetchJobs();
  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].status, 'RUNNING');
  assert.equal(jobs[1].status, 'COMPLETED');
  for (const job of jobs) assert.deepEqual(
    Object.keys(job).sort(),
    ['id', 'repository', 'status', 'title', 'updatedAt'],
  );
  assert.ok(!JSON.stringify(jobs).includes('secret'));
  assert.ok(!JSON.stringify(jobs).includes('private owner'));
});

test('Job normalization rejects malformed entries', () => {
  const jobs = normalizeJobs({ jobs: [null, {}, { id: '../x', state: 'RUNNING' },
    { id: 13, state: 'ACTIVE', runtimeStatus: 'WAITING', title: 'Valid' }] });
  assert.deepEqual(jobs, [{ id: '13', title: 'Valid',
    repository: '', status: 'WAITING', updatedAt: '' }]);
});
