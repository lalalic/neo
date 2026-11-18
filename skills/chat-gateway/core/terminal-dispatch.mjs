import { createHash } from 'node:crypto';

const iso = (ms) => new Date(ms).toISOString();
const concise = (value, max = 160) => String(value ?? '').replace(/[\r\n\t]/g, ' ').slice(0, max);

/** Internal trigger only; the Orchestrator owns verification and the user report. */
export function terminalTurn(record) {
  const jobId = concise(record.jobId, 64);
  const repository = concise(record.repository, 120);
  const job = repository ? `${repository}/${jobId}` : jobId;
  const state = record.to === 'CANCELLED' ? 'cancelled' : 'completed';
  const identity = JSON.stringify({ repository, jobId, status: record.to, at: record.terminalUpdatedAt });
  return `[Neo Chat Gateway: automated Relay terminal event]
requestId: ${requestIdFor(record.key ?? identity)}
Job ${job} ${state} (unverified event).
Check the authoritative Relay Job, JEL and deliverables. Then chat_report to the user concisely via mcp.chat-gateway chat_report({text, level:"attention", jobId:"${jobId}"}). Mention remaining work if cancelled or blocked. Do not report the raw event or start another Job.`;
}

const requestIdFor = (key) =>
  (key.startsWith('watch:') ? 'relay-watch-' : 'relay-terminal-') + createHash('sha256').update(key).digest('hex').slice(0, 40);

/**
 * Queue each terminal transition once to the bound Orchestrator thread.
 * Queue acknowledgement does not imply the Orchestrator has reported.
 * Ambiguous sends retain their idempotency identity and retry with backoff.
 */
export function createTerminalDispatcher({
  ledger, chat, submit, now = () => Date.now(), log = () => {},
  batchSize = 3, backoff = { baseMs: 5_000, capMs: 3_600_000 },
} = {}) {
  let running = false;
  let lastError = null;
  let lastSubmittedAt = null;

  async function tick() {
    if (running) return;
    running = true;
    try {
      const pending = ledger.pending().filter(record => record.kind === 'job' || record.kind === 'watch')
        .filter(record => !record.requestId || (record.nextAttemptAt ?? 0) <= now())
        .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))
        .slice(0, batchSize);
      if (!pending.length) return;
      for (const selected of pending) {
        const record = ledger.get(selected.key);
        if (record?.status !== 'pending') continue;
        // Successor handoff can occur mid-batch: route each event to the
        // current verified head rather than a cached previous one.
        const head = await chat.head();
        if (!head.bound) return; // Preserve events while Project initializes.
        const requestId = requestIdFor(record.key);
        const text = record.turnText ?? terminalTurn(record);
        // Legacy pending Jobs may carry attempts/backoff from the retired direct-push path.
        const attempts = record.requestId ? (record.attempts ?? 0) + 1 : 1;
        await ledger.put({ ...record, turnText: text, requestId, attempts });
        try {
          await submit({
            threadId: head.threadId, ...(head.projectId ? { projectId: head.projectId } : {}),
            requestId, text,
          });
          const current = ledger.get(record.key);
          await ledger.put({ ...current, status: 'submitted', submittedAt: iso(now()), lastError: null });
          lastSubmittedAt = iso(now());
          lastError = null;
        } catch (error) {
          const message = String(error?.message ?? error).slice(0, 180);
          const current = ledger.get(record.key);
          await ledger.put({
            ...current, status: 'pending', lastError: message,
            nextAttemptAt: now() + Math.min(backoff.capMs, backoff.baseMs * 2 ** (attempts - 1)),
          });
          lastError = message;
          log('terminal_dispatch.failed', { jobId: record.jobId, error: message });
        }
      }
    } finally {
      running = false;
    }
  }

  return {
    tick,
    status: () => ({
      pending: ledger.pending().filter(record => record.kind === 'job' || record.kind === 'watch').length, running,
      lastSubmittedAt, lastError,
    }),
  };
}
