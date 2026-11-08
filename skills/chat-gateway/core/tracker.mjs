import { isTerminalStatus, jobKey } from './job-status.mjs';

const SNAPSHOT_RETENTION_MS = 30 * 24 * 60 * 60_000;

/**
 * Tracks job states and turns terminal transitions into ledger records.
 * Both inputs use the same `job:<id>:<state>:<updatedAt>` key.
 */
export function createTracker({ ledger, snapshotFile, files, now = () => Date.now(), titleLookup = null }) {
  let snapshot = { baselined: false, baselineAt: null, jobs: {} };
  const iso = () => new Date(now()).toISOString();

  async function load() {
    const saved = await files.readJson(snapshotFile, {});
    snapshot = {
      baselined: saved.baselined === true,
      baselineAt: saved.baselineAt ?? null,
      jobs: saved.jobs && typeof saved.jobs === 'object' ? saved.jobs : {},
    };
  }

  const save = () => files.writeJsonAtomic(snapshotFile, snapshot);

  async function recordTerminal({ jobId, to, updatedAt, title, repository, source, status = 'pending' }) {
    if (!Number.isFinite(Date.parse(updatedAt))) return false;
    const key = jobKey(jobId, to, updatedAt);
    if (ledger.has(key)) return false;
    await ledger.put({
      kind: 'job',
      key,
      jobId,
      to,
      terminalUpdatedAt: updatedAt,
      title: title || null,
      repository: repository || null,
      source,
      status,
      attempts: 0,
      nextAttemptAt: 0,
      createdAt: iso(),
    });
    return true;
  }

  const entry = (job, previous) => ({
    status: job.status,
    title: job.title || previous?.title || '',
    repository: job.repository || previous?.repository || '',
    updatedAt: job.updatedAt || previous?.updatedAt || '',
    seenAt: iso(),
  });

  /** Handle one parsed `job.runtime_status.changed` event. Returns true when a notification was queued. */
  async function observeEvent(event) {
    const previous = snapshot.jobs[event.jobId];
    let title = previous?.title || '';
    if (isTerminalStatus(event.to) && !title && titleLookup) {
      title = (await titleLookup(event.jobId).catch(() => '')) || '';
    }
    snapshot.jobs[event.jobId] = entry({
      status: event.to, title, repository: event.repository, updatedAt: event.updatedAt,
    }, previous);
    let queued = false;
    if (isTerminalStatus(event.to)) {
      queued = await recordTerminal({
        jobId: event.jobId, to: event.to, updatedAt: event.updatedAt, title,
        repository: event.repository || previous?.repository, source: 'event',
      });
    }
    await save();
    return queued;
  }

  /** Handle the normalized dashboard job list (the most recently updated jobs). */
  async function observeJobs(jobs) {
    if (!snapshot.baselined) {
      let count = 0;
      for (const job of jobs) {
        snapshot.jobs[job.id] = entry(job);
        if (isTerminalStatus(job.status)) {
          await recordTerminal({
            jobId: job.id, to: job.status, updatedAt: job.updatedAt, title: job.title, repository: job.repository,
            source: 'baseline', status: 'baseline',
          });
          count += 1;
        }
      }
      snapshot.baselined = true;
      snapshot.baselineAt = iso();
      await save();
      return { baseline: true, baselined: count, added: 0, released: 0 };
    }

    const baselineMs = Date.parse(snapshot.baselineAt);
    let added = 0;
    let released = 0;
    for (const job of jobs) {
      const previous = snapshot.jobs[job.id];
      if (isTerminalStatus(job.status)) {
        // Enrich an event-origin pending notification with the dashboard's job title.
        const pending = ledger.get(jobKey(job.id, job.status, job.updatedAt));
        if (pending?.status === 'pending' && !pending.title && job.title) {
          await ledger.put({ ...pending, title: job.title, repository: job.repository || pending.repository });
        }
        // A job never seen before counts only if it changed after we started watching.
        const changed = previous ? previous.status !== job.status : Date.parse(job.updatedAt) > baselineMs;
        if (changed && await recordTerminal({
          jobId: job.id, to: job.status, updatedAt: job.updatedAt, title: job.title, repository: job.repository, source: 'reconcile',
        })) added += 1;
      } else if (previous && isTerminalStatus(previous.status)) {
        // Keep the delivered ledger identity; a reopened job gets a new terminal timestamp.
        released += 1;
      }
      snapshot.jobs[job.id] = entry(job, previous);
    }
    const cutoff = now() - SNAPSHOT_RETENTION_MS;
    for (const [id, value] of Object.entries(snapshot.jobs)) {
      if (Date.parse(value.seenAt) < cutoff) delete snapshot.jobs[id];
    }
    await save();
    return { baseline: false, baselined: 0, added, released };
  }

  return {
    load,
    observeEvent,
    observeJobs,
    isBaselined: () => snapshot.baselined,
    snapshot: () => snapshot,
  };
}
