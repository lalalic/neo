import { join } from 'node:path';

const THREAD_ID = /^[A-Za-z0-9_-]{8,160}$/;
const PROJECT_ID = /^g-p-[A-Za-z0-9_-]{8,128}$/;
const REQUEST_ID = /^[A-Za-z0-9_-]{8,128}$/;

/** The recurring envelope is intentionally tiny. Instructions and history live
 * in the Project; only current routing identity belongs in each owner turn. */
export function ownerTurn({requestId, text, projectId, threadId, attachments = []}) {
  const head = [
    `[Neo Mobile owner message id=${requestId}]`,
    '[Short context]',
    'source: neo-mobile',
    `headThreadId: ${threadId}`,
    ...(projectId ? [`projectId: ${projectId}`] : []),
    'replyVia: mcp.chat-gateway chat_report',
    'replyRequired: MUST call chat_report for every user-facing answer; a ChatGPT web reply is not delivered to Neo Mobile',
    '[User]',
    text,
  ];
  if (attachments.length) {
    head.push('Attachments: ' + attachments.map(a => String(a.name).replace(/[\r\n\t]/g, ' ')).join(', '));
  }
  return head.join('\n');
}

export function createChat({ ledger, files, dir, submit, attachmentStore, verifyProjectThread, now = () => Date.now() }) {
  const headFile = join(dir, 'head.json');
  const inFlight = new Map();
  // Handoffs are serialized: competing successor requests must not overwrite
  // each other after running independent browser verification.
  let binding = Promise.resolve();
  const serializeBinding = fn => {
    const work = binding.then(fn);
    binding = work.catch(() => {});
    return work;
  };
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
      return serializeBinding(async () => {
        if (!args || typeof args !== 'object' || Array.isArray(args) ||
            Object.keys(args).some((key) => !['threadId','previousThreadId'].includes(key)) ||
            !THREAD_ID.test(args.threadId ?? '')) {
          throw new Error('chat_bind requires one valid threadId');
        }
        const existing = await readHead();
        // A new head can only be installed after independently verifying that
        // its canonical ChatGPT conversation belongs to the existing Project.
        // The initiating model cannot self-certify its own handoff identifier.
        if (!PROJECT_ID.test(existing?.projectId ?? '')) {
          throw new Error('chat_bind requires an initialized orchestrator Project');
        }
        if (args.threadId !== existing.threadId) {
          if (args.previousThreadId !== existing.threadId) {
            throw new Error('chat_bind requires the previous head thread ID for an atomic handoff');
          }
          if (typeof verifyProjectThread !== 'function') {
            throw new Error('chat_bind Project verification unavailable');
          }
          const verified = await verifyProjectThread({
            projectId: existing.projectId, threadId: args.threadId,
          });
          if (verified !== true) throw new Error('chat_bind Project verification failed');
        }
        // Do not allow a slow verification to overwrite a newer head installed
        // through another process or during a Project bootstrap.
        const current = await readHead();
        if (current?.threadId !== existing.threadId || current?.projectId !== existing.projectId) {
          throw new Error('chat_bind head changed during validation');
        }
        await files.writeJsonAtomic(headFile, {
          threadId: args.threadId,
          projectId: existing.projectId,
          since: new Date(now()).toISOString(),
        });
        return { bound: true, threadId: args.threadId };
      });
    },
    /** Only verified project-setup receipts may install a Project binding. */
    async bindSystem({ threadId, projectId }) {
      return serializeBinding(async () => {
        if (!THREAD_ID.test(threadId ?? '') || !PROJECT_ID.test(projectId ?? '')) {
          throw new Error('Invalid verified Project/thread binding');
        }
        await files.writeJsonAtomic(headFile, { threadId, projectId, since: new Date(now()).toISOString() });
        return { bound: true, projectId, threadId };
      });
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
            text: ownerTurn({requestId: args.requestId, text, attachments, projectId: head.projectId, threadId: head.threadId}),
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
