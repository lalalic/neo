import { randomUUID } from 'node:crypto';
import { validateReport } from '../mcp/tools.mjs';

/** Records all valid reports. Only attention reports enter the notification queue. */
export function createReporter({ ledger, now = () => Date.now() }) {
  return {
    async report(args) {
      const checked = validateReport(args);
      if (!checked.ok) throw new Error(checked.error);
      const id = randomUUID();
      const record = {
        kind: 'report', key: `report:${id}`, id, ...checked.value,
        status: checked.value.level === 'attention' ? 'pending' : 'stored',
        createdAt: new Date(now()).toISOString(), attempts: 0, nextAttemptAt: 0,
      };
      await ledger.put(record);
      return { id, status: record.status, notificationQueued: record.status === 'pending' };
    },
  };
}
