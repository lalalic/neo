import { createHash } from 'node:crypto';

export const NOTIFY_KINDS = Object.freeze(['completed', 'blocked', 'failure']);

const ENDPOINT = /^http:\/\/127\.0\.0\.1:\d+\/mcp$/;
// Only these two Neo setup commands may ever be sent by this service.
const NOTIFY_COMMAND = /^events notify (completed|blocked|failure) "[^"\\\n]{1,100}" [^"\\\n]{1,240}$/;
const STATUS_COMMAND = 'events status';

/** Make free text safe to embed in a Neo setup command line. */
export function sanitizeText(value, max, fallback = '-') {
  const text = String(value ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/["\\`$]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim();
  return text || fallback;
}

export function buildNotifyCommand({ kind, title, body }) {
  if (!NOTIFY_KINDS.includes(kind)) throw new Error(`Unsupported notification kind: ${String(kind).slice(0, 20)}`);
  const command = `events notify ${kind} "${sanitizeText(title, 100, 'Neo')}" ${sanitizeText(body, 240)}`;
  if (!NOTIFY_COMMAND.test(command)) throw new Error('Notification command failed validation');
  return command;
}

/** Notification for orchestrator reports; `needs` marks that the owner has to act. */
export function reportNotification(reports) {
  const first = reports[0];
  const needsOwner = reports.some((r) => r.needs && r.needs !== 'none');
  const kind = needsOwner ? 'blocked' : 'completed';
  if (reports.length === 1) {
    const needs = first.needs && first.needs !== 'none' ? ` [needs: ${first.needs}]` : '';
    return { kind, title: 'Orchestrator report', body: `${first.text}${needs}` };
  }
  return {
    kind,
    title: `${reports.length} orchestrator reports`,
    body: `${first.text.slice(0, 160)} (+${reports.length - 1} more)`,
  };
}

async function readBody(response) {
  const type = response.headers?.get?.('content-type') ?? '';
  if (type.includes('text/event-stream')) {
    const text = await response.text();
    const line = text.split('\n').find((l) => l.startsWith('data:'));
    return JSON.parse(line ? line.slice(5).trim() : '{}');
  }
  return response.json();
}

/** Client for the local Neo.app MCP `setup` tool, restricted to notification commands. */
export function createNeoNotifier({ endpoint, fetcher = fetch, timeoutMs = 15_000 }) {
  if (!ENDPOINT.test(endpoint)) throw new Error('Neo MCP endpoint must be http://127.0.0.1:PORT/mcp');

  async function callSetup(command) {
    if (command !== STATUS_COMMAND && !NOTIFY_COMMAND.test(command)) {
      throw new Error('Neo setup command is not allowed');
    }
    const response = await fetcher(endpoint, {
      method: 'POST',
      redirect: 'error',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: Date.now(), method: 'tools/call',
        params: { name: 'setup', arguments: { command } },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`Neo MCP HTTP ${response.status}`);
    const body = await readBody(response);
    if (body.error) throw new Error(`Neo MCP error: ${String(body.error.message ?? 'unknown').slice(0, 200)}`);
    const text = (body.result?.content ?? []).filter((c) => c?.type === 'text').map((c) => c.text).join('\n');
    if (body.result?.isError) throw new Error(`Neo setup error: ${text.slice(0, 200)}`);
    return text;
  }

  return {
    /** Delivery is acknowledged only when Neo answers without an error. */
    async send({ kind, title, body, idempotencyKey }) {
      const command = buildNotifyCommand({ kind, title, body });
      const text = await callSetup(command);
      const seed = idempotencyKey || command;
      return { ok: true, deliveryId: createHash('sha256').update(seed).digest('hex').slice(0, 16), response: text.slice(0, 200) };
    },
    /** Read-only check that Neo answers and whether each notification kind is enabled by policy. */
    async probe() {
      const policy = JSON.parse(await callSetup(STATUS_COMMAND));
      return { reachable: true, policy };
    },
  };
}

export function createDryRunNotifier({ log = () => {} } = {}) {
  return {
    async send({ kind, title, body, idempotencyKey }) {
      const command = buildNotifyCommand({ kind, title, body });
      log('dry-run.notify', { command });
      return { ok: true, deliveryId: createHash('sha256').update(idempotencyKey || command).digest('hex').slice(0, 16), response: 'dry-run' };
    },
    async probe() {
      return { reachable: true, policy: { dryRun: true } };
    },
  };
}
