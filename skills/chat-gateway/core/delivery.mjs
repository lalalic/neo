import {
  jobNotification, jobSummaryNotification, reportNotification,
} from './notify.mjs';

const iso = (ms) => new Date(ms).toISOString();

/**
 * Delivers pending ledger records to the phone.
 * - A record becomes `delivered` only after the notifier acknowledges it.
 * - Failures back off exponentially (capped) and the record stays pending.
 * - More than `burst.max` due jobs collapse into one summary notification.
 * - Attention reports are leading-edge throttled: first notification wins; later
 *   reports in that 60-second window are persisted as coalesced (not re-pushed).
 */
export function createDelivery({
  ledger,
  notifier,
  now = () => Date.now(),
  log = () => {},
  settleMs = 1_500,
  burst = { max: 5 },
  attentionWindowMs = 60_000,
  backoff = { baseMs: 5_000, capMs: 3_600_000 },
}) {
  let lastOkAt = null;
  let lastError = null;
  let running = false;

  const due = (record) => (record.nextAttemptAt ?? 0) <= now()
    && now() - Date.parse(record.createdAt) >= settleMs;

  async function deliver(records, notification) {
    const idempotencyKey = records.map((r) => r.key).join(',');
    try {
      const ack = await notifier.send({ ...notification, idempotencyKey });
      if (!ack?.ok || !ack?.deliveryId) throw new Error('Notifier did not acknowledge delivery');
      for (const record of records) {
        await ledger.put({
          ...record,
          status: 'delivered',
          deliveredAt: iso(now()),
          deliveryId: ack.deliveryId,
          ...(records.length > 1 ? { coalescedInto: ack.deliveryId } : {}),
        });
      }
      lastOkAt = iso(now());
      lastError = null;
      return true;
    } catch (error) {
      const message = String(error?.message ?? error).slice(0, 200);
      for (const record of records) {
        const attempts = (record.attempts ?? 0) + 1;
        await ledger.put({
          ...record,
          attempts,
          lastError: message,
          nextAttemptAt: now() + Math.min(backoff.capMs, backoff.baseMs * 2 ** (attempts - 1)),
        });
      }
      lastError = message;
      log('delivery.failed', { count: records.length, error: message });
      return false;
    }
  }

  /** One delivery pass; safe to call concurrently (a running pass makes the call a no-op). */
  async function tick() {
    if (running) return;
    running = true;
    try {
      const jobs = ledger.pending('job').filter(due);
      if (jobs.length > burst.max) {
        await deliver(jobs, jobSummaryNotification(jobs));
      } else {
        for (const record of jobs) await deliver([record], jobNotification(record));
      }
      const reports = ledger.pending('report').filter(due);
      if (reports.length) {
        const latest = ledger.all().filter((r) => r.kind === 'report' && r.status === 'delivered')
          .sort((a, b) => Date.parse(b.deliveredAt) - Date.parse(a.deliveredAt))[0];
        if (latest && now() - Date.parse(latest.deliveredAt) < attentionWindowMs) {
          for (const record of reports) {
            await ledger.put({ ...record, status: 'coalesced', coalescedInto: latest.deliveryId });
          }
        } else {
          await deliver(reports, reportNotification(reports));
        }
      }
    } finally {
      running = false;
    }
  }

  return {
    tick,
    status: () => ({
      lastOkAt,
      lastError,
      pending: ledger.pending().length,
    }),
  };
}
