import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const DEFAULTS = Object.freeze({
  natsUrl: 'nats://127.0.0.1:4222',
  subjectPrefix: 'neo.events.job',
  dashboardUrl: 'http://127.0.0.1:8787',
  port: 8791,
  reconcileIntervalMs: 5 * 60_000,
  deliveryTickMs: 1_000,
  settleMs: 1_500,
  retentionMs: 90 * 24 * 60 * 60_000,
});

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const DEFAULT_NEO_MCP_PORT = 6767;
const LEGACY_NEO_MCP_PORT = 9224;

function readJson(read, path) {
  try {
    return JSON.parse(read(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error(`Cannot load ${path}: ${error.message}`);
  }
}

function requireLoopback(name, value, protocol) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid ${name}: ${String(value).slice(0, 80)}`);
  }
  if (url.protocol !== protocol || !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error(`${name} must be a ${protocol}// loopback URL`);
  }
  return value.replace(/\/+$/, '');
}

function requirePort(name, value) {
  const port = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid ${name}: ${String(value).slice(0, 20)}`);
  }
  return port;
}

/** Local Neo.app MCP listener, resolved like Neo CLI does: loopback only. */
export function resolveNeoMcpEndpoint({ env = process.env, read = readFileSync, home = homedir() } = {}) {
  if (env.CHAT_GATEWAY_NEO_MCP_URL) {
    if (!/^http:\/\/127\.0\.0\.1:\d+\/mcp$/.test(env.CHAT_GATEWAY_NEO_MCP_URL)) {
      throw new Error('CHAT_GATEWAY_NEO_MCP_URL must be http://127.0.0.1:PORT/mcp');
    }
    return env.CHAT_GATEWAY_NEO_MCP_URL;
  }
  const file = join(home, 'Library/Application Support/NeoY/deployment.json');
  const config = readJson(read, file);
  let port = DEFAULT_NEO_MCP_PORT;
  if (config?.mcpPort !== undefined) {
    port = config.mcpPort === LEGACY_NEO_MCP_PORT ? DEFAULT_NEO_MCP_PORT : config.mcpPort;
  }
  return `http://127.0.0.1:${requirePort('Neo.app MCP port', port)}/mcp`;
}

/** Same NATS resolution order as Agents Relay and Events Bus. */
export function resolveConfig({ env = process.env, read = readFileSync, home = homedir() } = {}) {
  const runtime = readJson(read, join(home, 'Library/Application Support/EventsBus/runtime.json')) ?? {};
  const natsUrl = env.NEO_NATS_URL || runtime.natsUrl || DEFAULTS.natsUrl;
  if (!/^nats:\/\//.test(natsUrl)) throw new Error('NEO_NATS_URL must start with nats://');
  requireLoopback('NATS URL', natsUrl.replace(/^nats:/, 'http:'), 'http:');
  const subjectPrefix = env.NEO_EVENTS_SUBJECT_PREFIX || runtime.subjectPrefix || DEFAULTS.subjectPrefix;
  if (!/^[A-Za-z0-9_.-]+$/.test(subjectPrefix)) throw new Error('Invalid events subject prefix');
  const dashboardUrl = requireLoopback(
    'Dashboard URL', env.CHAT_GATEWAY_DASHBOARD_URL || DEFAULTS.dashboardUrl, 'http:');
  return {
    natsUrl,
    subjectPrefix,
    subject: `${subjectPrefix}.*.job.runtime_status.changed`,
    dashboardUrl,
    port: requirePort('CHAT_GATEWAY_PORT', env.CHAT_GATEWAY_PORT ?? DEFAULTS.port),
    stateDir: env.CHAT_GATEWAY_STATE_DIR || join(home, '.local/state/neo/chat-gateway'),
    neoMcpEndpoint: resolveNeoMcpEndpoint({ env, read, home }),
    reconcileIntervalMs: DEFAULTS.reconcileIntervalMs,
    deliveryTickMs: DEFAULTS.deliveryTickMs,
    settleMs: DEFAULTS.settleMs,
    retentionMs: DEFAULTS.retentionMs,
  };
}
