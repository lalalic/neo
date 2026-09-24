#!/usr/bin/env node
import { hostname } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const neoRoot = resolve(here, '..');
const natsTransport = resolve(neoRoot, 'skills/events-bus/transport/nats.mjs');
const SERVICE_NAME = 'neo-package-service-updater';
const NATS_URL = process.env.NEO_NATS_URL || 'nats://127.0.0.1:4222';
const POLL_INTERVAL_MS = 2000;
const PULLABLE_TIMEOUT_MS = 5 * 60 * 1000;
const ONLINE_TIMEOUT_MS = 60 * 1000;

function run(command, args = [], timeoutMs = 30000) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: timeoutMs, env: process.env });
  return { code: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function sleep(ms) {
  return new Promise(resolveSleep => setTimeout(resolveSleep, ms));
}

export function publicationFromEvent(event) {
  if (!event || event.type !== 'package.published' || event.status !== 'succeeded') return null;
  const data = event.data && typeof event.data === 'object' ? event.data : {};
  if (typeof data.package !== 'string' || !data.package || typeof data.version !== 'string' || !data.version) return null;
  return {
    jobId: typeof event.job_id === 'string' ? event.job_id : '',
    taskId: typeof event.task_id === 'string' ? event.task_id : null,
    orchestratorId: typeof event.orchestrator_id === 'string' ? event.orchestrator_id : null,
    packageName: data.package,
    version: data.version,
    registry: typeof data.registry === 'string' && data.registry ? data.registry : 'https://registry.npmjs.org',
    repository: typeof data.repository === 'string' ? data.repository : null,
    prNumber: Number.isInteger(data.prNumber) ? data.prNumber : null,
  };
}

function packageNameFromSpec(spec) {
  if (typeof spec !== 'string' || !spec) return null;
  if (spec.startsWith('@')) {
    const slash = spec.indexOf('/');
    if (slash < 0) return null;
    const versionAt = spec.indexOf('@', slash);
    return versionAt < 0 ? spec : spec.slice(0, versionAt);
  }
  const versionAt = spec.indexOf('@');
  return versionAt < 0 ? spec : spec.slice(0, versionAt);
}

export function discoverPackageServices(pm2List, packageName) {
  if (!Array.isArray(pm2List)) return [];
  const services = [];
  for (const process of pm2List) {
    const env = process?.pm2_env;
    const launcher = basename(String(env?.pm_exec_path || ''));
    if (!['npx', 'npm'].includes(launcher)) continue;
    const args = Array.isArray(env?.args) ? env.args.map(String) : [];
    let matched = false;
    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index];
      if ((arg === '-p' || arg === '--package') && packageNameFromSpec(args[index + 1]) === packageName) matched = true;
      if (arg.startsWith('--package=') && packageNameFromSpec(arg.slice('--package='.length)) === packageName) matched = true;
    }
    if (matched && typeof process.name === 'string' && process.name) {
      services.push({ name: process.name, status: typeof env?.status === 'string' ? env.status : null });
    }
  }
  return services;
}

function pm2List() {
  const result = run('npx', ['pm2', 'jlist'], 30000);
  if (result.code !== 0) throw new Error('pm2 jlist failed: ' + result.stderr.trim());
  try { return JSON.parse(result.stdout); }
  catch { throw new Error('pm2 jlist returned invalid JSON'); }
}

async function waitUntilPullable(packageName, version, registry) {
  const deadline = Date.now() + PULLABLE_TIMEOUT_MS;
  let last = '';
  while (Date.now() < deadline) {
    const result = run('npm', ['view', packageName + '@' + version, 'version', '--registry=' + registry], 30000);
    last = result.stdout.trim();
    if (result.code === 0 && last === version) return;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`${packageName}@${version} did not become pullable within ${PULLABLE_TIMEOUT_MS}ms (last=${last || 'unavailable'})`);
}

async function waitUntilOnline(service) {
  const deadline = Date.now() + ONLINE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const current = pm2List().find(item => item?.name === service);
    if (current?.pm2_env?.status === 'online') return;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`${service} did not become online within ${ONLINE_TIMEOUT_MS}ms`);
}

async function emit(input, type, status, message, data) {
  if (!input.jobId) return;
  const event = {
    version: 1,
    event_id: randomUUID(),
    job_id: input.jobId,
    orchestrator_id: input.orchestratorId,
    task_id: 'service:' + data.service,
    parent_task_id: input.taskId,
    type,
    status,
    timestamp: new Date().toISOString(),
    source: { id: `service-updater/${hostname()}/${data.service}`, component: 'package-service-updater', host: hostname() },
    visibility: status === 'failed' ? 'user' : 'orchestrator',
    level: status === 'failed' ? 'error' : 'info',
    message,
    data,
  };
  const result = run(process.execPath, [natsTransport, 'pub', `neo.events.job.${input.jobId}.${type}`, JSON.stringify(event)], 30000);
  if (result.code !== 0) throw new Error('event publish failed: ' + result.stderr.trim());
}

const inFlight = new Set();

export async function handlePublicationEvent(event) {
  const publication = publicationFromEvent(event);
  if (!publication) return { action: 'ignored', reason: 'not-package-publication' };
  const key = publication.packageName + '@' + publication.version;
  if (inFlight.has(key)) return { action: 'ignored', reason: 'already-in-flight' };
  inFlight.add(key);
  try {
    await waitUntilPullable(publication.packageName, publication.version, publication.registry);

    const targets = discoverPackageServices(pm2List(), publication.packageName);
    if (targets.length === 0) return { action: 'ignored', reason: 'no-matching-pm2-service' };

    const results = [];
    for (const target of targets) {
      const data = {
        package: publication.packageName,
        version: publication.version,
        registry: publication.registry,
        repository: publication.repository,
        prNumber: publication.prNumber,
        service: target.name,
      };
      try {
        await emit(publication, 'service.deploy.started', 'running', `Restarting ${target.name} for ${publication.packageName}@${publication.version}`, data);
        const restarted = run('npx', ['pm2', 'restart', target.name], 60000);
        if (restarted.code !== 0) throw new Error('pm2 restart failed: ' + restarted.stderr.trim());
        await waitUntilOnline(target.name);
        await emit(publication, 'service.deploy.completed', 'succeeded', `Restarted ${target.name} for ${publication.packageName}@${publication.version}`, data);
        results.push({ service: target.name, status: 'completed' });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await emit(publication, 'service.deploy.failed', 'failed', message, data).catch(() => {});
        results.push({ service: target.name, status: 'failed', error: message });
      }
    }
    return { action: 'processed', package: publication.packageName, version: publication.version, results };
  } finally {
    inFlight.delete(key);
  }
}

async function daemon() {
  const child = spawn(process.execPath, [natsTransport, 'sub', 'neo.events.job.*.package.published'], {
    stdio: ['ignore', 'pipe', 'inherit'],
    env: { ...process.env, NEO_NATS_URL: NATS_URL },
  });
  child.stdout.setEncoding('utf8');
  let buffer = '';
  child.stdout.on('data', chunk => {
    buffer += chunk;
    for (;;) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) break;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      try {
        const event = JSON.parse(line);
        void handlePublicationEvent(event)
          .then(result => process.stdout.write(JSON.stringify(result) + '\n'))
          .catch(error => process.stderr.write((error instanceof Error ? error.stack ?? error.message : String(error)) + '\n'));
      } catch (error) {
        process.stderr.write('invalid event: ' + (error instanceof Error ? error.message : String(error)) + '\n');
      }
    }
  });
  const code = await new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('exit', value => resolveExit(value ?? 1));
  });
  if (code !== 0) throw new Error(`events subscription exited with code ${code}`);
}

function install() {
  const script = fileURLToPath(import.meta.url);
  const dependency = run('npm', ['ci', '--omit=dev', '--prefix', resolve(neoRoot, 'skills/events-bus')], 120000);
  if (dependency.code !== 0) throw new Error('events-bus dependency install failed: ' + dependency.stderr.trim());

  run('launchctl', ['bootout', `gui/${process.getuid()}/com.neo.package-service-updater`], 30000);
  run('rm', ['-f', resolve(process.env.HOME, 'Library/LaunchAgents/com.neo.package-service-updater.plist')], 30000);
  run('rm', ['-rf', resolve(process.env.HOME, '.neo/package-service-updater/runtime')], 30000);
  run('rm', ['-f', resolve(process.env.HOME, '.neo/package-service-updater.json')], 30000);
  run('rm', ['-f', resolve(process.env.HOME, '.neo/package-service-updater-state.json')], 30000);

  run('npx', ['pm2', 'delete', SERVICE_NAME], 30000);
  const started = spawnSync('npx', [
    'pm2', 'start', script,
    '--name', SERVICE_NAME,
    '--interpreter', process.execPath,
    '--cwd', neoRoot,
    '--time',
  ], {
    encoding: 'utf8',
    env: { ...process.env, NEO_NATS_URL: NATS_URL },
    timeout: 60000,
  });
  if ((started.status ?? 1) !== 0) throw new Error('pm2 start failed: ' + (started.stderr || '').trim());
  const saved = run('npx', ['pm2', 'save'], 60000);
  if (saved.code !== 0) throw new Error('pm2 save failed: ' + saved.stderr.trim());
  process.stdout.write(`installed ${SERVICE_NAME} from ${script}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const command = process.argv[2] || 'daemon';
  if (command === 'install') {
    try { install(); }
    catch (error) {
      process.stderr.write((error instanceof Error ? error.stack ?? error.message : String(error)) + '\n');
      process.exitCode = 1;
    }
  } else if (command === 'daemon') {
    daemon().catch(error => {
      process.stderr.write((error instanceof Error ? error.stack ?? error.message : String(error)) + '\n');
      process.exitCode = 1;
    });
  } else {
    process.stderr.write('usage: package-service-updater.mjs [install|daemon]\n');
    process.exitCode = 2;
  }
}
