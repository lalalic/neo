import { validateFeed } from '../mcp/tools.mjs';

/** Owner-safe timeline: no job prompts, paths, credentials or raw events. */
export function createFeed({ ledger }) {
  return {
    list(args = {}) {
      const limit = validateFeed(args);
      const items = ledger.all().filter((r) =>
        (r.kind === 'job' && r.status !== 'baseline') ||
        r.kind === 'report' || r.kind === 'owner'
      ).map((r) => {
        const at = r.createdAt ?? r.updatedAt;
        if (r.kind === 'job') return {
          id: r.key, kind: 'job', text: r.title || `Job ${r.jobId}`,
          jobId: r.jobId, status: r.to, repository: r.repository ?? '', at,
        };
        if (r.kind === 'report') return {
          id: r.key, kind: 'report', text: r.text,
          level: r.level, needs: r.needs ?? 'none', jobId: r.jobId ?? null, at,
        };
        return { id: r.key, kind: 'owner', text: r.text, status: r.status, at };
      }).sort((a, b) => (a.at ?? '').localeCompare(b.at ?? '') || a.id.localeCompare(b.id));
      return { items: items.slice(-limit), total: items.length };
    },
  };
}
