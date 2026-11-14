import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const NOTIFY_KINDS = Object.freeze(['completed', 'blocked', 'failure']);

const ENDPOINT = /^http:\/\/127\.0\.0\.1:\d+\/mcp$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUS_COMMAND = 'events status';

/** Bound and sanitize owner-visible APNs content. Never log private device tokens. */
export function sanitizeText(value, max, fallback = '-') {
  const text = String(value ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim();
  return text || fallback;
}

export function reportNotification(reports) {
  const first = reports[0];
  const needsOwner = reports.some((r) => r.needs && r.needs !== 'none');
  const kind = needsOwner ? 'blocked' : 'completed';
  if (reports.length === 1) {
    const needs = first.needs && first.needs !== 'none' ? ` [needs: ${first.needs}]` : '';
    return { kind, title: 'Orchestrator report', body: `${first.text}${needs}` };
  }
  return { kind, title: `${reports.length} orchestrator reports`,
    body: `${first.text.slice(0, 160)} (+${reports.length - 1} more)` };
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

/**
 * Neo.app exposes local APNs submission to registered Neo Mobile devices.
 * Its legacy `events notify` Tool routes to the phone's *foreground* local MCP
 * and hangs when Neo Mobile is backgrounded; it cannot provide push alerts.
 * The loopback-only /mobile/notify route uses Apple's push transport instead.
 */
export function createNeoNotifier({
  endpoint, fetcher = fetch, timeoutMs = 20_000,
  apnsDir = join(homedir(), 'Library/Application Support/NeoY/apns'),
  read = readFile, fileStat = stat,
} = {}) {
  if (!ENDPOINT.test(endpoint)) throw new Error('Neo MCP endpoint must be http://127.0.0.1:PORT/mcp');
  const baseUrl = endpoint.slice(0, -'/mcp'.length);

  async function policy() {
    const response = await fetcher(endpoint, {
      method: 'POST', redirect: 'error',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({jsonrpc: '2.0', id: Date.now(), method: 'tools/call',
        params: {name: 'setup', arguments: {command: STATUS_COMMAND}}}),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`Neo MCP HTTP ${response.status}`);
    const rpc = await readBody(response);
    if (rpc.error || rpc.result?.isError) throw new Error('Neo event notification policy unavailable');
    const text = (rpc.result?.content ?? []).filter(c => c?.type === 'text').map(c => c.text).join('\n');
    const parsed = JSON.parse(text);
    if (!parsed || NOTIFY_KINDS.some(kind => typeof parsed[kind] !== 'boolean'))
      throw new Error('Invalid Neo notification policy');
    return parsed;
  }

  async function targetIds() {
    let devices;
    try { devices = JSON.parse(await read(join(apnsDir, 'devices.json'), 'utf8')).devices; }
    catch { throw new Error('Neo APNs device registry unavailable'); }
    if (!devices || typeof devices !== 'object' || Array.isArray(devices))
      throw new Error('Invalid Neo APNs device registry');
    return Object.entries(devices)
      .filter(([id, item]) => UUID.test(id) && item &&
        typeof item.token === 'string' && item.token.length >= 64 &&
        ['sandbox', 'production'].includes(item.environment))
      .sort((a,b) => (b[1].updatedAt || '').localeCompare(a[1].updatedAt || ''))
      .slice(0, 10)
      .map(([id]) => id);
  }

  return {
    async send({ kind, title, body, idempotencyKey }) {
      if (!NOTIFY_KINDS.includes(kind)) throw new Error('Unsupported notification kind');
      const enabled = await policy();
      if (!enabled[kind]) throw new Error('Neo notification kind disabled by owner policy');
      const targets = await targetIds();
      if (!targets.length) throw new Error('No registered Neo Mobile APNs target');
      const deliveryId = createHash('sha256').update(idempotencyKey || `${kind}:${title}:${body}`).digest('hex').slice(0, 16);
      const safeTitle = sanitizeText(title, 160, 'Neo');
      const safeBody = sanitizeText(body, 170);
      // Neo Master's native /mobile/notify handler fans out to its own
      // registered APNs devices. One request only: calling once *per* device
      // would duplicate pushes across every device.
      const response = await fetcher(`${baseUrl}/mobile/notify`, {
        method:'POST',redirect:'error',
        headers:{'content-type':'application/json','accept':'application/json'},
        body:JSON.stringify({id:targets[0],title:safeTitle,body:safeBody,payload:{neoNotificationId:deliveryId}}),
        signal:AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok || (await response.json())?.accepted !== true)
        throw new Error('Neo APNs did not accept the notification for any registered device');
      return {ok:true,deliveryId,response:'apns_accepted'};
    },
    async probe() {
      const enabled = await policy();
      let config;
      try { config = JSON.parse(await read(join(apnsDir, 'config.json'), 'utf8')); }
      catch { throw new Error('Neo APNs configuration unavailable'); }
      if (config?.topic !== 'com.neox.app' || !config?.keyPath ||
          config?.keyId?.length !== 10 || config?.teamId?.length !== 10 ||
          !(await fileStat(config.keyPath).catch(() => null))?.isFile()) {
        throw new Error('Neo APNs signing configuration incomplete');
      }
      const targets = await targetIds();
      if (!targets.length) throw new Error('No registered Neo Mobile APNs targets');
      return {reachable:true,policy:enabled,targets:targets.length,transport:'apns'};
    },
  };
}

export function createDryRunNotifier({ log = () => {} } = {}) {
  return {
    async send({kind,title,body,idempotencyKey}) {
      if (!NOTIFY_KINDS.includes(kind)) throw new Error('Unsupported notification kind');
      log('dry-run.notify',{kind,title:sanitizeText(title,160),body:sanitizeText(body,170)});
      return {ok:true,deliveryId:createHash('sha256').update(idempotencyKey || `${kind}:${title}:${body}`).digest('hex').slice(0,16),response:'dry-run'};
    },
    async probe() {return {reachable:true,policy:{dryRun:true},transport:'dry-run'};},
  };
}
