export const TERMINAL_STATUSES = Object.freeze(new Set(['COMPLETED', 'CANCELLED']));

export const isTerminalStatus = (status) => TERMINAL_STATUSES.has(status);

/** Stable identity for one Relay terminal transition across event and reconciliation. */
export const jobKey = (jobId, to, updatedAt) => `job:${jobId}:${to}:${updatedAt}`;

const clip = (value, max) => (typeof value === 'string' && value ? value.slice(0, max) : undefined);

function normalizeJobId(value) {
  if (Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(value)) return value;
  return null;
}

/**
 * Validate a Relay `job.runtime_status.changed` envelope.
 * Returns a small normalized record, or null for anything malformed.
 */
export function parseRuntimeStatusEvent(envelope) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) return null;
  if (envelope.type !== 'job.runtime_status.changed') return null;
  const jobId = normalizeJobId(envelope.job_id);
  const data = envelope.data;
  if (jobId === null || !data || typeof data !== 'object' || Array.isArray(data)) return null;
  const to = typeof data.to === 'string' ? data.to.trim().toUpperCase() : '';
  if (!/^[A-Z_]{2,40}$/.test(to)) return null;
  if (!Number.isFinite(Date.parse(data.updatedAt))) return null;
  return {
    jobId,
    to,
    from: clip(data.from, 40),
    updatedAt: clip(data.updatedAt, 40),
    repository: clip(data.repository, 120),
    eventId: clip(envelope.event_id, 80),
  };
}
