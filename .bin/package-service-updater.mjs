#!/usr/bin/env node
import { hostname, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const neoRoot = resolve(here, '..');
const natsTransport = resolve(neoRoot, 'skills/events-bus/transport/nats.mjs');
const SERVICE_NAME = 'neo/package-service-updater';
const LEGACY_SERVICE_NAME = 'neo-package-service-updater';
const NATS_URL = process.env.NEO_NATS_URL || 'nats://127.0.0.1:4222';
const POLL_INTERVAL_MS = 2000;
const PULLABLE_TIMEOUT_MS = 5 * 60 * 1000;
const ONLINE_TIMEOUT_MS = 60 * 1000;

function run(command, args = [], timeoutMs = 30000, env = process.env) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: timeoutMs, env });
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
    let explicitPackage = false;
    let firstPositional = null;
    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index];
      if (arg === '-p' || arg === '--package') {
        explicitPackage = true;
        if (packageNameFromSpec(args[++index]) === packageName) matched = true;
        continue;
      }
      if (arg.startsWith('--package=')) {
        explicitPackage = true;
        if (packageNameFromSpec(arg.slice('--package='.length)) === packageName) matched = true;
        continue;
      }
      if (['--registry', '--workspace', '--prefix', '--call', '-c'].includes(arg)) {
        index += 1;
        continue;
      }
      if (arg.startsWith('-')) continue;
      if (firstPositional === null) firstPositional = arg;
    }
    // npx -y wechat-bro@latest --daemon does not use a --package flag.
    // Only the first positional token is the direct package launcher.
    if (!explicitPackage && packageNameFromSpec(firstPositional) === packageName) matched = true;
    if (matched && typeof process.name === 'string' && process.name) {
      services.push({ name: process.name, status: typeof env?.status === 'string' ? env.status : null });
    }
  }
  return services;
}

/**
 * A successfully packed artifact may be visible before the registry latest
 * dist-tag moves. Avoid restarting an @latest PM2 launcher onto an older
 * version or replaying obsolete publication events.
 */
export async function waitUntilLatest(packageName, version, registry, options = {}) {
  const timeoutMs = options.timeoutMs ?? PULLABLE_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
  const runCommand = options.run ?? run;
  const sleepFor = options.sleep ?? sleep;
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    const result = runCommand('npm', [
      'view', packageName, 'dist-tags.latest',
      '--registry=' + registry, '--prefer-online',
    ], 30000);
    if (result.code === 0) {
      last = result.stdout.trim().replace(/^["']|["']$/g, '');
      if (last === version) return;
      // A different latest tag is not a valid deployment target. Wait briefly
      // for propagation; never restart to an unverified tag.
    } else {
      last = (result.stderr || result.stdout || 'unknown error').trim();
    }
    await sleepFor(pollIntervalMs);
  }
  throw new Error(`latest dist-tag for ${packageName} did not become ${version} (last=${last})`);
}

function pm2List() {
  const result = run('npx', ['pm2', 'jlist'], 30000);
  if (result.code !== 0) throw new Error('pm2 jlist failed: ' + result.stderr.trim());
  try { return JSON.parse(result.stdout); }
  catch { throw new Error('pm2 jlist returned invalid JSON'); }
}

export async function waitUntilPullable(packageName, version, registry, options = {}) {
  const timeoutMs = options.timeoutMs ?? PULLABLE_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
  const runCommand = options.run ?? run;
  const sleepFor = options.sleep ?? sleep;
  const makeTempDir = options.makeTempDir ?? (() => mkdtemp(join(tmpdir(), 'neo-package-service-updater-')));
  const removeTempDir = options.removeTempDir ?? (directory => rm(directory, { recursive: true, force: true }));
  const deadline = Date.now() + timeoutMs;
  let last = 'unavailable';
  while (Date.now() < deadline) {
    let directory;
    try {
      directory = await makeTempDir();
      const result = runCommand('npm', [
        'pack',
        packageName + '@' + version,
        '--pack-destination', directory,
        '--registry=' + registry,
        '--ignore-scripts',
      ], 30000);
      const artifacts = result.code === 0 ? await readdir(directory) : [];
      const artifact = artifacts.find(name => name.endsWith('.tgz'));
      if (result.code === 0 && artifact) return;
      last = (result.stderr || result.stdout || 'artifact was not produced').trim();
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    } finally {
      if (directory) await removeTempDir(directory).catch(() => {});
    }
    await sleepFor(pollIntervalMs);
  }
  throw new Error(`${packageName}@${version} artifact was not fetchable within ${timeoutMs}ms (last=${last})`);
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

export async function handlePublicationEvent(event, dependencies = {}) {
  const publication = publicationFromEvent(event);
  if (!publication) return { action: 'ignored', reason: 'not-package-publication' };
  const key = publication.packageName + '@' + publication.version;
  if (inFlight.has(key)) return { action: 'ignored', reason: 'already-in-flight' };
  inFlight.add(key);
  try {
    await (dependencies.waitUntilPullable ?? waitUntilPullable)(publication.packageName, publication.version, publication.registry);

    await (dependencies.waitUntilLatest ?? waitUntilLatest)(publication.packageName, publication.version, publication.registry);
    const listServices = dependencies.pm2List ?? pm2List;
    const targets = discoverPackageServices(listServices(), publication.packageName);
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
        const restarted = (dependencies.restart ?? (() => run('npx', ['pm2', 'restart', target.name, '--update-env'], 60000,
          { ...process.env, npm_config_prefer_online: 'true' })))();
        if (restarted.code !== 0) throw new Error('pm2 restart failed: ' + restarted.stderr.trim());
        await (dependencies.waitUntilOnline ?? waitUntilOnline)(target.name);
        await (dependencies.emit ?? emit)(publication, 'service.deploy.completed', 'succeeded', `Restarted ${target.name} for ${publication.packageName}@${publication.version}`, data);
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

  const inventory = pm2List();
  const legacy = inventory.find(entry => entry.name === LEGACY_SERVICE_NAME);
  const modern = inventory.find(entry => entry.name === SERVICE_NAME);
  if (!modern) {
    const defined = run('serviceman', [
      'define', '--skill', 'neo', '--service', 'package-service-updater', '--apply', '--',
      process.execPath, script, 'daemon',
    ], 60000);
    if (defined.code !== 0) throw new Error('service definition failed: ' + defined.stderr.trim());
    const created = pm2List().find(entry => entry.name === SERVICE_NAME);
    if (created?.pm2_env?.status !== 'online') throw new Error(SERVICE_NAME + ' failed to start');
  }

  if (legacy) {
    // Do not leave two active subscribers to the same package.published event.
    const removed = run('npx', ['--yes','pm2', 'delete', LEGACY_SERVICE_NAME], 30000);
    if (removed.code !== 0) throw new Error('legacy watcher removal failed: ' + removed.stderr.trim());
  }
  const saved = run('npx', ['--yes','pm2', 'save'], 60000);
  if (saved.code !== 0) throw new Error('pm2 save failed: ' + saved.stderr.trim());
  process.stdout.write(`installed ${SERVICE_NAME} from ${script}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
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
