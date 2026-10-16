// One caller-facing event shape for MCP and CLI. Expand only at the transport boundary.
export function expandPublishEvent({ type, source, data = {} }) {
  const match = /^job\/([^/]+)\/task\/(.+)\/execution\/([^/]+)$/.exec(source ?? '');
  if (!match) throw new Error('source must be job/<job-id>/task/<task-id>/execution/<execution-id>');
  if (typeof type !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(type)) throw new Error('invalid event type');
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('data must be an object');
  const status = type.endsWith('.completed') || type.endsWith('.approved') ? 'succeeded'
    : type.endsWith('.failed') ? 'failed' : type.endsWith('.blocked') ? 'blocked'
    : type.endsWith('.cancelled') ? 'cancelled' : type.endsWith('.started') ? 'running' : 'running';
  return { job_id: match[1], task_id: match[2], type, status,
    visibility: 'orchestrator', message: typeof data.message === 'string' && data.message ? data.message : type,
    source: { id: source }, data };
}
