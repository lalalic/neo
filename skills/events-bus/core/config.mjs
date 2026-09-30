import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_DATA_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'EventsBus');
export const DEFAULT_NATS_URL = 'nats://127.0.0.1:4222';
export const DEFAULT_API_HOST = '127.0.0.1';
export const DEFAULT_API_PORT = 4223;
export const DEFAULT_SUBJECT_PREFIX = 'neo.events.job';

export function runtimeConfigPath(env = process.env) {
  if (env.NEO_EVENTS_BUS_CONFIG) return env.NEO_EVENTS_BUS_CONFIG;
  const dataDir = env.EVENTS_BUS_DATA_DIR || DEFAULT_DATA_DIR;
  return path.join(dataDir, 'runtime.json');
}

function readRuntimeFile(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

export function resolveRuntimeConfig(env = process.env) {
  const file = runtimeConfigPath(env);
  const saved = readRuntimeFile(file);
  const dataDir = env.EVENTS_BUS_DATA_DIR || saved.dataDir || path.dirname(file) || DEFAULT_DATA_DIR;
  const apiHost = env.NEO_EVENTS_API_HOST || saved.apiHost || DEFAULT_API_HOST;
  const apiPort = Number(env.NEO_EVENTS_API_PORT || saved.apiPort || DEFAULT_API_PORT);
  const apiUrl = env.NEO_EVENTS_API_URL || saved.apiUrl || `http://${apiHost}:${apiPort}`;
  return {
    version: 1,
    configPath: file,
    dataDir,
    historyFile: path.join(dataDir, 'events.jsonl'),
    natsUrl: env.NEO_NATS_URL || saved.natsUrl || DEFAULT_NATS_URL,
    apiHost,
    apiPort,
    apiUrl,
    subjectPrefix: env.NEO_EVENTS_SUBJECT_PREFIX || saved.subjectPrefix || DEFAULT_SUBJECT_PREFIX,
  };
}

export function writeRuntimeConfig(config, env = process.env) {
  const target = runtimeConfigPath(env);
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const payload = {
    version: 1,
    natsUrl: config.natsUrl,
    apiHost: config.apiHost,
    apiPort: config.apiPort,
    apiUrl: config.apiUrl,
    dataDir: config.dataDir,
    subjectPrefix: config.subjectPrefix,
  };
  fs.writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  return target;
}
