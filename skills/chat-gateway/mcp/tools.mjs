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
