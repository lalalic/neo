import { appendFile, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ensureDir } from './files.mjs';

const FILE_MODE = 0o600;

const iso = (ms) => new Date(ms).toISOString();

/**
 * Durable append-only ledger (JSONL). The newest line per `key` wins.
 * A `release` tombstone forgets every job key of one job so a reopened job can notify again.
 * Records are written before they are acted on, so restarts and retries are safe.
 */
export async function openLedger({ dir, now = () => Date.now() }) {
  await ensureDir(dir);
  const file = join(dir, 'ledger.jsonl');
  const index = new Map();
  let queue = Promise.resolve();
  const enqueue = (task) => {
    const run = queue.then(task);
    queue = run.catch(() => {});
    return run;
  };

  function apply(record) {
    if (record.kind === 'release') {
      for (const [key, value] of index) {
        if (value.kind === 'job' && value.jobId === record.jobId) index.delete(key);
      }
      return;
    }
    if (typeof record.key === 'string') index.set(record.key, record);
  }

  let text = '';
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      apply(JSON.parse(line));
    } catch {
      // A torn final line from a crash is ignored; earlier lines stay valid.
    }
  }

  const append = (record) => appendFile(file, `${JSON.stringify(record)}\n`, { mode: FILE_MODE });

  return {
    file,
    get: (key) => index.get(key),
    has: (key) => index.has(key),
    hasJob: (jobId) => [...index.values()].some((r) => r.kind === 'job' && r.jobId === jobId),
    all: () => [...index.values()],
    pending: (kind) => [...index.values()].filter((r) => r.status === 'pending' && (!kind || r.kind === kind)),

    put(record) {
      return enqueue(async () => {
        const full = { ...record, updatedAt: iso(now()) };
        await append(full);
        apply(full);
        return full;
      });
    },

    releaseJob(jobId) {
      return enqueue(async () => {
        const tombstone = { kind: 'release', jobId, at: iso(now()) };
        await append(tombstone);
        apply(tombstone);
      });
    },

    counts() {
      const result = { total: index.size, pending: 0, delivered: 0, baseline: 0, stored: 0 };
      for (const record of index.values()) {
        if (record.status in result) result[record.status] += 1;
      }
      return result;
    },

    /** Rewrite the file from live state; old finished records are dropped, pending ones never. */
    compact({ maxAgeMs }) {
      return enqueue(async () => {
        const cutoff = now() - maxAgeMs;
        let dropped = 0;
        for (const [key, record] of index) {
          if (record.status === 'pending') continue;
          const at = Date.parse(record.updatedAt ?? record.createdAt);
          if (Number.isFinite(at) && at < cutoff) {
            index.delete(key);
            dropped += 1;
          }
        }
        const body = [...index.values()].map((r) => JSON.stringify(r)).join('\n');
        const temp = `${file}.${process.pid}.tmp`;
        await writeFile(temp, body ? `${body}\n` : '', { mode: FILE_MODE });
        await rename(temp, file);
        return { dropped, kept: index.size };
      });
    },
  };
}
