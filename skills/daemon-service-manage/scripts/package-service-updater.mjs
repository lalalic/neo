#!/usr/bin/env node
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir, hostname } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const natsTransport = resolve(here, '../../events-bus/transport/nats.mjs');
const defaultConfigPath = resolve(homedir(), '.neo/package-service-updater.json');
const defaultStatePath = resolve(homedir(), '.neo/package-service-updater-state.json');

export function publicationFromEvent(event) {
  if (!event || event.type !== 'package.published' || event.status !== 'succeeded') return null;
  const data = event.data && typeof event.data === 'object' ? event.data : {};
  if (typeof data.package !== 'string' || !data.package || typeof data.version !== 'string' || !data.version) return null;
  return {
    jobId: typeof event.job_id === 'string' ? event.job_id : '',
    orchestratorId: typeof event.orchestrator_id === 'string' ? event.orchestrator_id : null,
    taskId: typeof event.task_id === 'string' ? event.task_id : null,
    packageName: data.package,
    version: data.version,
    registry: typeof data.registry === 'string' && data.registry ? data.registry : 'https://registry.npmjs.org',
    repository: typeof data.repository === 'string' ? data.repository : null,
    prNumber: Number.isInteger(data.prNumber) ? data.prNumber : null,
  };
}

export async function loadJson(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error?.code === 'ENOENT') return fallback; throw error; }
}

export async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temp = path + '.tmp-' + process.pid;
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  await rename(temp, path);
}

export function runCommand(command, args = [], options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: options.timeoutMs ?? 30000, env: process.env });
  return { code: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function commandSpec(value) {
  if (!Array.isArray(value) || value.length === 0 || value.some(item => typeof item !== 'string' || !item)) return null;
  return { command: value[0], args: value.slice(1) };
}

export class PackageServiceUpdater {
  constructor({ config, state = { deployed: {} }, execute = runCommand, emit = async () => {}, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), saveState = async () => {} }) {
    this.config = config;
    this.state = state;
    if (!this.state.deployed || typeof this.state.deployed !== 'object') this.state.deployed = {};
    this.execute = execute;
    this.emit = emit;
    this.sleep = sleep;
    this.saveState = saveState;
    this.inFlight = new Set();
  }

  async handle(event) {
    const publication = publicationFromEvent(event);
    if (!publication || !publication.jobId) return { action: 'ignored', reason: 'not-package-publication' };
    const target = this.config?.packages?.[publication.packageName];
    if (!target || typeof target.pm2Service !== 'string' || !target.pm2Service) return { action: 'ignored', reason: 'unconfigured-package' };
    const key = publication.packageName + '@' + publication.version;
    if (this.state.deployed[publication.packageName] === publication.version || this.inFlight.has(key)) return { action: 'ignored', reason: 'already-deployed' };

    this.inFlight.add(key);
    const baseData = {
      package: publication.packageName,
      version: publication.version,
      registry: publication.registry,
      repository: publication.repository,
      prNumber: publication.prNumber,
      service: target.pm2Service,
    };
    try {
      const pullable = this.execute('npm', ['view', publication.packageName + '@' + publication.version, 'version', '--registry=' + publication.registry], { timeoutMs: 30000 });
      if (pullable.code !== 0 || pullable.stdout.trim() !== publication.version) throw new Error('exact package version is not pullable');

      await this.emit(event, 'service.deploy.started', 'running', `Deploying ${publication.packageName}@${publication.version} to ${target.pm2Service}`, baseData);

      const restart = this.execute('npx', ['pm2', 'restart', target.pm2Service], { timeoutMs: 60000 });
      if (restart.code !== 0) throw new Error('PM2 restart failed: ' + restart.stderr.trim());

      const settleMs = Number.isFinite(target.settleMs) ? Math.max(0, target.settleMs) : 2000;
      if (settleMs) await this.sleep(settleMs);

      const health = commandSpec(target.healthCommand);
      if (health) {
        const checked = this.execute(health.command, health.args, { timeoutMs: target.verifyTimeoutMs ?? 30000 });
        if (checked.code !== 0) throw new Error('health verification failed: ' + checked.stderr.trim());
      }

      const version = commandSpec(target.versionCommand);
      if (version) {
        const checked = this.execute(version.command, version.args, { timeoutMs: target.verifyTimeoutMs ?? 30000 });
        if (checked.code !== 0 || checked.stdout.trim() !== publication.version) throw new Error(`running version mismatch: expected ${publication.version}, observed ${checked.stdout.trim() || 'unavailable'}`);
      }

      const save = this.execute('npx', ['pm2', 'save'], { timeoutMs: 60000 });
      if (save.code !== 0) throw new Error('PM2 save failed: ' + save.stderr.trim());

      this.state.deployed[publication.packageName] = publication.version;
      this.state.updatedAt = new Date().toISOString();
      await this.saveState(this.state);
      await this.emit(event, 'service.deploy.completed', 'succeeded', `Deployed ${publication.packageName}@${publication.version} to ${target.pm2Service}`, baseData);
      return { action: 'deployed', package: publication.packageName, version: publication.version, service: target.pm2Service };
    } catch (error) {
      await this.emit(event, 'service.deploy.failed', 'failed', error instanceof Error ? error.message : String(error), baseData);
      return { action: 'failed', error: error instanceof Error ? error.message : String(error) };
    } finally {
      this.inFlight.delete(key);
    }
  }
}

export async function publishDeploymentEvent(input, type, status, message, data) {
  const output = {
    version: 1,
    event_id: randomUUID(),
    job_id: input.job_id,
    orchestrator_id: input.orchestrator_id ?? null,
    task_id: 'service:' + data.service,
    parent_task_id: input.task_id ?? null,
    type,
    status,
    timestamp: new Date().toISOString(),
    source: { id: `service-updater/${hostname()}/${data.service}`, component: 'package-service-updater', host: hostname() },
    visibility: status === 'failed' ? 'user' : 'orchestrator',
    level: status === 'failed' ? 'error' : 'info',
    message,
    data,
  };
  const subject = `neo.events.job.${input.job_id}.${type}`;
  const result = runCommand(process.execPath, [natsTransport, 'pub', subject, JSON.stringify(output)], { timeoutMs: 30000 });
  if (result.code !== 0) throw new Error('deployment event publish failed: ' + result.stderr.trim());
}

export async function runDaemon({ configPath = process.env.NEO_PACKAGE_SERVICE_CONFIG || defaultConfigPath, statePath = process.env.NEO_PACKAGE_SERVICE_STATE || defaultStatePath } = {}) {
  const config = await loadJson(configPath, null);
  if (!config?.packages || typeof config.packages !== 'object') throw new Error(`package-service updater config missing packages map: ${configPath}`);
  const state = await loadJson(statePath, { deployed: {} });
  const updater = new PackageServiceUpdater({
    config,
    state,
    emit: publishDeploymentEvent,
    saveState: value => writeJsonAtomic(statePath, value),
  });

  const child = spawn(process.execPath, [natsTransport, 'sub', 'neo.events.job.*.package.published'], { stdio: ['ignore', 'pipe', 'inherit'], env: process.env });
  child.stdout.setEncoding('utf8');
  let buffer = '';
  child.stdout.on('data', chunk => {
    buffer += chunk;
    while (true) {
      const index = buffer.indexOf('\n');
      if (index < 0) break;
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      try {
        const event = JSON.parse(line);
        void updater.handle(event).then(result => process.stdout.write(JSON.stringify(result) + '\n'));
      } catch (error) {
        process.stderr.write(`package-service updater ignored invalid event: ${error instanceof Error ? error.message : String(error)}\n`);
      }
    }
  });
  const exitCode = await new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('exit', code => resolveExit(code ?? 1));
  });
  if (exitCode !== 0) throw new Error(`events-bus subscription exited with code ${exitCode}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runDaemon().catch(error => {
    process.stderr.write((error instanceof Error ? error.stack ?? error.message : String(error)) + '\n');
    process.exitCode = 1;
  });
}
