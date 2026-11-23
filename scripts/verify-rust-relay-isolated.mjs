#!/usr/bin/env node
/**
 * Real Neo Harness Rust -> Rust Relay E2E in a disposable Git/SQLite/daemon.
 * Requires Node 22.5+ only as a TEST DRIVER (not as a Harness runtime).
 * Usage: node scripts/verify-rust-relay-isolated.mjs /absolute/agents-relay/repo
 * Nothing in the user's production Relay SQLite, Jobs or Projects is modified.
 */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, cpSync, chmodSync, closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const harnessRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = process.argv[2];
if (!sourceRoot || !isAbsolute(sourceRoot)) {
  process.stderr.write('Usage: node scripts/verify-rust-relay-isolated.mjs /absolute/agents-relay/repo\n');
  process.exit(2);
}
const original = join(homedir(), '.local/share/agents-relay/live/bin');
for (const file of [
  join(original, 'agents-relay-rust'),
  join(original, 'agents-relayd-rust'),
  join(sourceRoot, 'rust/target/debug/owned-process-supervisor'),
  join(sourceRoot, 'rust/src/unified_relay_schema.rs'),
  join(sourceRoot, 'workflow')
]) assert(existsSync(file), `required Relay test dependency missing: ${file}`);

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function freePort() {
  const socket = createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  socket.close();
  await once(socket, 'close');
  return port;
}

async function main() {
  const base = mkdtempSync(join(tmpdir(), 'neo-harness-real-relay-'));
  let daemon;
  let logFd;
  try {
    const workspace = join(base, 'workspace');
    const project = join(workspace, 'sample');
    const run = join(project, 'runs', '2026-11-23-episode');
    const stores = join(base, 'stores');
    const home = join(base, 'home');
    const binaries = join(base, 'isolated-binaries');
    mkdirSync(run, { recursive: true });
    for (const dir of [stores, home, binaries]) mkdirSync(dir);
    copyFileSync(join(original, 'agents-relay-rust'), join(binaries, 'agents-relay-rust'));
    copyFileSync(join(original, 'agents-relayd-rust'), join(binaries, 'agents-relayd-rust'));
    copyFileSync(join(sourceRoot, 'rust/target/debug/owned-process-supervisor'), join(binaries, 'owned-process-supervisor'));
    for (const name of ['agents-relay-rust', 'agents-relayd-rust', 'owned-process-supervisor']) chmodSync(join(binaries, name), 0o755);
    cpSync(join(sourceRoot, 'workflow'), join(base, 'workflow'), { recursive: true });

    writeFileSync(join(project, 'AGENTS.md'), '# Isolated Neo Test\n');
    writeFileSync(join(project, 'README.md'), '# Test Project\n');
    writeFileSync(join(project, 'graph.mmd'), 'flowchart TD\n  A[agent:writer] --> B[agent:editor]\n');
    writeFileSync(join(project, 'project.run.json'), JSON.stringify({
      schemaVersion: 1,
      input: { type: 'path', path: { base: 'runs', datedRunDirectory: true } },
      versioning: { mode: 'local-git', template: 'run-template' }
    }));
    mkdirSync(join(project, 'run-template'));
    writeFileSync(join(project, 'run-template/.gitignore'), '.neo-project-run.json\nsource-reference.json\nneo-project-run.*\n');
    execFileSync('git', ['init', '-q', project]);
    const config = join(base, 'workspace.json');
    writeFileSync(config, JSON.stringify({ schemaVersion: 1, neoRoot: workspace }));

    // Official *schema only*; no production SQLite contents or WAL copied.
    const schemaText = readFileSync(join(sourceRoot, 'rust/src/unified_relay_schema.rs'), 'utf8');
    const schema = /r####"([\s\S]*?)"####;/.exec(schemaText)?.[1];
    assert(schema, 'Cannot resolve canonical Rust Relay schema');
    const dbPath = join(base, 'relay.sqlite');
    const init = new DatabaseSync(dbPath);
    init.exec(schema);
    init.close();

    const port = await freePort();
    const environment = {
      ...process.env,
      HOME: home,
      AGENTS_RELAY_STORE_DIR: join(home, '.agents-relay/stores'),
      AGENTS_RELAY_WORKSPACE_ROOT: workspace,
      NEO_ROOT: workspace,
      NEO_WORKSPACE_CONFIG: config,
      NEO_RELAY_EXECUTABLE: join(binaries, 'agents-relay-rust'),
      NEO_RELAY_CONTROL_PORT: String(port)
    };
    logFd = openSync(join(base, 'daemon.log'), 'w');
    daemon = spawn(join(binaries, 'agents-relayd-rust'), [
      '--isolated-write-store-dir', stores,
      '--port', String(port), '--interval', '600000',
      '--repo', 'sample', '--workspace-root', workspace
    ], { cwd: base, env: environment, stdio: ['ignore', logFd, logFd] });
    let healthy = false;
    for (let i = 0; i < 45; i++) {
      if (daemon.exitCode !== null) break;
      try {
        const probe = await fetch(`http://127.0.0.1:${port}/api/status`, {
          signal: AbortSignal.timeout(500)
        });
        if (probe.ok) { healthy = true; break; }
      } catch { /* daemon is still starting */ }
      await delay(100);
    }
    assert(healthy, `Isolated Relay daemon unavailable: ${readFileSync(join(base, 'daemon.log'), 'utf8')}`);

    execFileSync('cargo', ['build', '--offline', '-q', '--workspace'], { cwd: harnessRoot, timeout: 90_000 });
    const rust = join(harnessRoot, 'target/debug/neo-rs');
    // This fixture represents a creator who completed Spec Kit Specify/Clarify
    // and independent Preflight Review. New Jobs require explicit attestation.
    const input = ['project', 'run', '--project', 'sample', '--path', run, '--preflight=true'];
    const execute = () => JSON.parse(execFileSync(rust, input, {
      cwd: workspace, env: environment, encoding: 'utf8', timeout: 20_000
    }));
    const created = execute();
    assert.equal(created.status, 'ACTIVE');
    assert.match(String(created.jobId), /^[1-9][0-9]*$/);
    assert.match(String(created.taskId), /^[1-9][0-9]*$/);
    assert(existsSync(join(run, '.neo-project-run.json')), 'private binding not written');
    assert.equal((readFileSync(join(run, '.neo-project-run.json')).length > 10), true);
    const before = execFileSync('git', ['-C', run, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const resumed = execute();
    assert.deepEqual(resumed, created, 'Run resume changed authoritative Job/Task');
    const after = execFileSync('git', ['-C', run, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    assert.equal(after, before, 'Run Git HEAD changed during idempotent resume');
    // Attach to the same ACTIVE Coordinator via the real Rust Relay CLI.
    // Terminate only this separate terminal process group; the daemon/Job
    // remain alive and resume must continue to resolve the exact same Job.
    const foreground = spawn(rust, [...input, '--foreground'], {
      cwd: workspace, env: environment, detached: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let streamed = '';
    let streamedError = '';
    const done = once(foreground, 'exit');
    const firstIdentity = new Promise(resolve => {
      foreground.stdout.on('data', bytes => {
        streamed += bytes.toString('utf8');
        if (streamed.includes('\n')) resolve();
      });
      foreground.stderr.on('data', bytes => { streamedError += bytes.toString('utf8'); });
    });
    try {
      await Promise.race([firstIdentity, delay(3500)]);
      assert(streamed.includes('\n'), `Foreground failed to publish attached Job identity: ${streamedError}`);
      const attached = JSON.parse(streamed.split('\n')[0]);
      assert.equal(attached.foreground, true);
      assert.equal(attached.status, 'ACTIVE');
      assert.equal(attached.jobId, created.jobId);
      assert.equal(attached.taskId, created.taskId);
      await delay(350);
      assert.equal(foreground.exitCode, null, `Foreground ended unexpectedly: ${streamedError}`);
    } finally {
      try { process.kill(-foreground.pid, 'SIGTERM'); } catch { /* already exited */ }
      await Promise.race([done, delay(1400)]);
      if (foreground.exitCode === null && foreground.signalCode === null) {
        try { process.kill(-foreground.pid, 'SIGKILL'); } catch { /* already exited */ }
        await Promise.race([done, delay(1000)]);
      }
    }
    const foregroundAttached = true;
    const verify = new DatabaseSync(dbPath, { readOnly: true });
    const count = verify.prepare('SELECT COUNT(*) AS n FROM job_snapshot').get().n;
    verify.close();
    assert.equal(count, 1, 'isolation run duplicated Coordinator Job');
    console.log(JSON.stringify({
      passed: true,
      mode: 'isolated-real-rust-relay',
      created: created.status,
      resumed: resumed.status,
      jobIdStable: created.jobId === resumed.jobId,
      taskIdStable: created.taskId === resumed.taskId,
      jobs: count,
      privateRunGitStable: before === after,
      foregroundAttached,
      productionStateTouched: false
    }, null, 2));
  } catch (error) {
    const daemonLog = existsSync(join(base, 'daemon.log')) ? readFileSync(join(base, 'daemon.log'), 'utf8') : '';
    process.stderr.write(`Isolated real Relay verification failed: ${error.message}\n${daemonLog.slice(-1600)}\n`);
    process.exitCode = 1;
  } finally {
    if (daemon?.exitCode === null) {
      daemon.kill('SIGTERM');
      await Promise.race([once(daemon, 'exit'), delay(1500)]);
      if (daemon.exitCode === null) {
        daemon.kill('SIGKILL');
        await Promise.race([once(daemon, 'exit'), delay(1500)]);
      }
    }
    if (logFd !== undefined) closeSync(logFd);
    rmSync(base, { recursive: true, force: true });
  }
}
await main();
