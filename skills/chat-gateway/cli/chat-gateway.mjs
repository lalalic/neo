#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { resolveConfig } from '../core/config.mjs';
import { createEnvStore } from '../core/env.mjs';
import { files } from '../core/files.mjs';
import { createGateway } from '../core/service.mjs';
import { registerGateway } from '../mcp/admin.mjs';

const print = (value) => console.log(JSON.stringify(value, null, 2));

export function parseArgs(argv) {
  const flags = { apply: false, dryRun: false };
  const words = [];
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === '--apply') flags.apply = true;
    else if (value === '--dry-run') flags.dryRun = true;
else if (value.startsWith('-')) throw new Error(`Unsupported option: ${value.slice(0, 40)}`);
    else words.push(value);
  }
  return { flags, words };
}

export function setupSteps({ config }) {
  const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  return {
    service: ['bash', join(sourceRoot, 'neo-project'), 'start'],
    source: join(sourceRoot, 'cli/chat-gateway.mjs'),
    federation: `mcp add chat-gateway http://127.0.0.1:${config.port}/mcp`,
    remoteExposure: 'deployment provider enable chat-gateway',
  };
}

async function waitForListener(port, attempts = 20) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) return;
    } catch { /* PM2 may still be starting the canonical source. */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Gateway service was defined but its MCP listener did not become ready');
}

async function commandMain(args) {
  const { flags, words } = parseArgs(args);
  const [command, sub, mode] = words;
  const config = resolveConfig();
  if (command === 'setup') {
    const steps = setupSteps({ config });
    if (!flags.apply) return print({ dryRun: true, ...steps });
    const { status, error } = spawnSync(steps.service[0], steps.service.slice(1), {
      stdio: 'inherit', timeout: 90_000, shell: false,
    });
    if (error || status !== 0) throw new Error(`Service definition failed (${error?.code || status})`);
    await waitForListener(config.port);
    return print(await registerGateway({ endpoint: config.neoMcpEndpoint, port: config.port }));
  }
  if (command === 'serve') {
    let ephemeral = null;
    if (flags.dryRun) {
      ephemeral = await mkdtemp(join(tmpdir(), 'neo-chat-gateway-dryrun-'));
      config.stateDir = ephemeral;
      config.port += 1;
    }
    const gateway = await createGateway({ config, dryRun: flags.dryRun });
    await gateway.start();
    const stop = async () => {
      await gateway.stop();
      if (ephemeral) await rm(ephemeral, { recursive: true, force: true });
      process.exit(0);
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    return;
  }
  if (command === 'health' || command === 'status') {
    const response = await fetch(`http://127.0.0.1:${config.port}/health`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error(`Gateway health HTTP ${response.status}`);
    return print(await response.json());
  }
  if (command === 'env') {
    const store = createEnvStore({ dir: config.stateDir, files });
    if (sub === 'get' || !sub) return print(await store.resolve());
    if (sub === 'set' && ['office', 'home', 'auto'].includes(mode)) {
      if (!flags.apply) return print({ dryRun: true, mode, note: 'Use --apply to change the override' });
      await store.setOverride(mode);
      return print(await store.resolve());
    }
    throw new Error('Usage: chat-gateway env get | set <office|home|auto> [--apply]');
  }
  throw new Error('Usage: chat-gateway setup [--apply] | serve [--dry-run] | health | status | env get | env set MODE [--apply]');
}

// Allow direct source execution and local bin symlinks.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  commandMain(process.argv.slice(2)).catch((error) => {
    console.error(`chat-gateway: ${String(error?.message ?? error).slice(0, 220)}`);
    process.exitCode = 1;
  });
}
