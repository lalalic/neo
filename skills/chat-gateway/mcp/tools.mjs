export const MAX_REPORT_CHARS = 2000;
const LEVELS = ['info', 'attention'];
const NEEDS = ['work_node', 'phone', 'none'];

export const TOOL_DEFS = Object.freeze([
  {
    name: 'chat_report',
    description: 'Report to the owner\'s phone when something deserves their attention: a result, a blocker, a milestone. '
      + 'Reporting is optional; stay silent when there is nothing worth saying. '
      + 'level=attention sends a phone notification, info only records the report. '
      + 'Call chat_env first when you need to ask the owner for help, and set needs to work_node or phone accordingly.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', minLength: 1, maxLength: MAX_REPORT_CHARS },
        level: { type: 'string', enum: LEVELS, default: 'info' },
        jobId: { type: 'string', pattern: '^[A-Za-z0-9_.-]{1,64}$' },
        needs: { type: 'string', enum: NEEDS },
      },
      required: ['text'],
      additionalProperties: false,
    },
  },
  {
    name: 'chat_bind',
    description: 'Bind this logical Neo Mobile chat to its current orchestrator ChatGPT thread. Invoke on head-thread handoff.',
    inputSchema: {
      type: 'object',
      properties: { threadId: { type: 'string', pattern: '^[A-Za-z0-9_-]{8,160}$' } },
      required: ['threadId'], additionalProperties: false,
    },
  },
  {
    name: 'chat_head',
    description: 'Return whether an orchestrator ChatGPT thread is bound for owner messages.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'chat_send',
    description: 'Submit an owner message from Neo Mobile to the bound orchestrator thread. The receipt means queued, not answered.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', maxLength: 2000 },
        attachments: { type: 'array', maxItems: 4, items: { type: 'object', properties: {
          id: { type: 'string' }, name: { type: 'string' },
        }, required: ['id', 'name'], additionalProperties: false } },
        requestId: { type: 'string', pattern: '^[A-Za-z0-9_-]{8,128}$' },
      },
      required: ['text', 'requestId'], additionalProperties: false,
    },
  },
  {
    name: 'chat_upload',
    description: 'Upload a protected chunk of a real attachment for a phone Chat turn. Duplicate chunks are idempotent.',
    inputSchema: {
      type: 'object',
      properties: {
        requestId: { type: 'string' }, attachmentId: { type: 'string' },
        name: { type: 'string' }, chunkIndex: { type: 'integer' },
        chunkCount: { type: 'integer' }, contentBase64: { type: 'string' },
        sha256: { type: 'string' }, size: { type: 'integer' },
      },
      required: ['requestId', 'attachmentId', 'name', 'chunkIndex', 'chunkCount',
        'contentBase64', 'sha256', 'size'], additionalProperties: false,
    },
  },
  {
    name: 'chat_jobs',
    description: 'List recent and active Relay jobs from the Neo Master dashboard. Returns only job ID, title, repository, status, and last update; no objectives or job prompts.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'integer', minimum: 1, maximum: 100, default: 100 } },
      additionalProperties: false,
    },
  },
  {
    name: 'chat_feed',
    description: 'Recent job completions, orchestrator reports and owner submissions for the authenticated Neo Mobile Chat tab.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 } },
      additionalProperties: false,
    },
  },
  {
    name: 'chat_env',
    description: 'Return the owner\'s current execution environment: mode (office or home), how it was determined '
      + '(override, observed or heuristic), since when, and the phone channel when known.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
]);

/** Validate chat_report input; returns { ok, value } or { ok: false, error }. */
export function validateReport(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return { ok: false, error: 'arguments must be an object' };
  const allowed = new Set(['text', 'level', 'jobId', 'needs']);
  const unknown = Object.keys(args).find((key) => !allowed.has(key));
  if (unknown) return { ok: false, error: `unknown field: ${unknown.slice(0, 40)}` };
  if (typeof args.text !== 'string') return { ok: false, error: 'text is required' };
  const text = args.text.trim();
  if (!text) return { ok: false, error: 'text must not be empty' };
  if (text.length > MAX_REPORT_CHARS) return { ok: false, error: `text must be at most ${MAX_REPORT_CHARS} characters` };
  const level = args.level ?? 'info';
  if (!LEVELS.includes(level)) return { ok: false, error: 'level must be info or attention' };
  let jobId;
  if (args.jobId !== undefined) {
    const raw = Number.isSafeInteger(args.jobId) ? String(args.jobId) : args.jobId;
    if (typeof raw !== 'string' || !/^[A-Za-z0-9_.-]{1,64}$/.test(raw)) return { ok: false, error: 'jobId is invalid' };
    jobId = raw;
  }
  if (args.needs !== undefined && !NEEDS.includes(args.needs)) {
    return { ok: false, error: 'needs must be work_node, phone or none' };
  }
  return { ok: true, value: { text, level, ...(jobId ? { jobId } : {}), ...(args.needs ? { needs: args.needs } : {}) } };
}


export function validateFeed(args = {}) {
  if (!args || typeof args !== 'object' || Array.isArray(args) ||
      Object.keys(args).some((key) => key !== 'limit')) {
    throw new Error('chat_feed only accepts limit');
  }
  if (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 100)) {
    throw new Error('limit must be an integer from 1 to 100');
  }
  return args.limit ?? 50;
}
