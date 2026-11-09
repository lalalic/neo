import { join } from 'node:path';

const THREAD_ID = /^[A-Za-z0-9_-]{8,160}$/;
const PROJECT_ID = /^g-p-[A-Za-z0-9_-]{8,128}$/;
const REQUEST_ID = /^[A-Za-z0-9_-]{8,128}$/;

export function createChat({ ledger, files, dir, submit, attachmentStore, now = () => Date.now() }) {
  const headFile = join(dir, 'head.json');
  const inFlight = new Map();
  const readHead = async () => {
    const saved = await files.readJson(headFile, {});
    return THREAD_ID.test(saved.threadId ?? '') ? saved : null;
  };
  return {
    async head() {
      const head = await readHead();
      return { bound: !!head, ...(head ? {
        threadId: head.threadId, since: head.since,
        ...(PROJECT_ID.test(head.projectId ?? '') ? { projectId: head.projectId } : {}),
      } : {}) };
    },
    async bind(args) {
      if (!args || typeof args !== 'object' || Array.isArray(args) ||
          Object.keys(args).some((key) => key !== 'threadId') ||
          !THREAD_ID.test(args.threadId ?? '')) {
        throw new Error('chat_bind requires one valid threadId');
      }
      const existing = await readHead();
      await files.writeJsonAtomic(headFile, {
        threadId: args.threadId,
        ...(PROJECT_ID.test(existing?.projectId ?? '') ? { projectId: existing.projectId } : {}),
        since: new Date(now()).toISOString(),
      });
      return { bound: true, threadId: args.threadId };
    },
    /** Only verified project-setup receipts may install a Project binding. */
    async bindSystem({ threadId, projectId }) {
      if (!THREAD_ID.test(threadId ?? '') || !PROJECT_ID.test(projectId ?? '')) {
        throw new Error('Invalid verified Project/thread binding');
      }
      await files.writeJsonAtomic(headFile, { threadId, projectId, since: new Date(now()).toISOString() });
      return { bound: true, projectId, threadId };
    },
    async send(args) {
      if (!args || typeof args !== 'object' || Array.isArray(args) ||
          Object.keys(args).some((key) => !['text', 'requestId', 'attachments'].includes(key)) ||
          typeof args.text !== 'string' ||
          args.text.trim().length > 2000 ||
          !Array.isArray(args.attachments ?? []) || (args.attachments ?? []).length > 4 ||
          (!args.text.trim() && !(args.attachments ?? []).length) ||
          !REQUEST_ID.test(args.requestId ?? '')) {
        throw new Error('chat_send requires text or attachments and requestId (8..128 safe characters)');
      }
      const text = args.text.trim();
      const attachments = args.attachments ?? [];
      if (attachments.some(a => !a || typeof a.id !== 'string' ||
            typeof a.name !== 'string' ||
            Object.keys(a).some(k => !['id', 'name'].includes(k)))) {
        throw new Error('Invalid attachment references');
      }
      const key = `owner:${args.requestId}`;
      if (inFlight.has(key)) return inFlight.get(key);
      const stored = ledger.get(key);
      if (stored && (stored.text !== text ||
          JSON.stringify(stored.attachments ?? []) !== JSON.stringify(attachments))) {
        throw new Error('requestId already belongs to a different message');
      }
      if (stored?.status === 'submitted') {
        return { id: args.requestId, status: 'submitted' };
      }
      const task = (async () => {
        const head = await readHead();
        if (!head) throw new Error('Orchestrator is initializing');
        const file = attachments.length ? await attachmentStore?.resolve(args.requestId, attachments) : [];
        if (attachments.length && (!file || file.length !== attachments.length)) {
          throw new Error('Attachment file store not configured');
        }
        const record = stored ?? {
          key, kind: 'owner', id: args.requestId, text, attachments,
          createdAt: new Date(now()).toISOString(),
        };
        // A previously failed/ambiguous attempt retains its identity and is
        // retried automatically by the phone outbox, never a new owner message.
        await ledger.put({
          ...record, status: 'pending', attempts: (record.attempts ?? 0) + 1,
        });
        try {
          await submit({
            threadId: head.threadId,
            requestId: args.requestId,
            file,
            ...(head.projectId ? { projectId: head.projectId } : {}),
            text: `[Neo Mobile owner message id=${args.requestId}]\n${text}${attachments.length ? '\nAttachments: ' + attachments.map(a => a.name).join(', ') : ''}\n\nThis owner message may be retried after a transport failure; avoid duplicate actions for the same id. Reply using mcp.chat-gateway chat_report when appropriate.`,
          });
          await ledger.put({ ...record, status: 'submitted', attempts: (record.attempts ?? 0) + 1 });
          return { id: args.requestId, status: 'submitted' };
        } catch (error) {
          await ledger.put({ ...record, status: 'failed', attempts: (record.attempts ?? 0) + 1 });
          throw error;
        }
      })();
      inFlight.set(key, task);
      try { return await task; } finally { inFlight.delete(key); }
    },
  };
}
