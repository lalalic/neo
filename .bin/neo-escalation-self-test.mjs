import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localEscalationConfig, runLocalEscalation } from './neo-local-escalation.mjs';

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

/**
 * Non-mutating proof that the configured Local Agent can reason, invoke a
 * real tool, return its observation, and unload its owned inference server.
 * No website, user account, messaging, or human approval is involved.
 */
export async function runEscalationSelfTest({
  agentPrompt,
  config = localEscalationConfig(),
  run = runLocalEscalation,
  processAlive = isAlive,
  random = () => randomBytes(16).toString('hex'),
  clock = () => Date.now(),
} = {}) {
  if (typeof agentPrompt !== 'string' || !agentPrompt.trim()) throw new Error('Local Agent prompt is required for self-test');
  const folder = mkdtempSync(join(tmpdir(), 'neo-escalation-test-'));
  const started = clock();
  let serverPid = null;
  try {
    const nonce = random();
    if (!/^[0-9a-f]{32}$/.test(nonce)) throw new Error('Invalid self-test nonce');
    const fixture = join(folder, 'nonce.txt');
    writeFileSync(fixture, nonce + '\n', {mode: 0o600});
    const request = {
      cwd: folder,
      handoff: [
        'Local Agent read-only self-test. Do not contact anyone, send notifications, open a website, or change files.',
        `Use your terminal / Shell tool to read the file at ${fixture}.`,
        'The secret test value is not in this handoff; do not guess it.',
        'Report status=resolved only after observing its actual value using a tool.',
        'Include the exact file value as a string in the evidence array; otherwise return status=failed.',
        'Return the usual complete escalation JSON schema.',
      ].join('\n'),
      onNeedsUser: 'Self-test only. Never notify a human; if a tool cannot run, return failed.',
    };
    const result = await run(request, {
      agentPrompt, config, redactResult: false,
      onServerStarted(pid) { serverPid = pid; },
    });
    if (result.status !== 'resolved') {
      throw new Error(`Local Agent self-test returned ${result.status}: ${result.summary || 'no summary'}`);
    }
    if (!Array.isArray(result.evidence) || !result.evidence.some(item => typeof item === 'string' && item.includes(nonce))) {
      throw new Error('Local Agent failed to demonstrate actual file-reading evidence');
    }
    if (config.engine !== 'external' && (!Number.isInteger(serverPid) || serverPid <= 0)) {
      throw new Error('Owned inference process was not observed');
    }
    if (serverPid && processAlive(serverPid)) {
      throw new Error('Owned inference process was not released after escalation');
    }
    return {
      status: 'pass',
      backend: 'local',
      engine: config.engine,
      model: config.model,
      checks: {
        shell_tool_execution: true,
        unknown_value_verified: true,
        model_process_released: config.engine === 'external' ? null : true,
        no_human_notification_requested: true,
      },
      duration_ms: clock() - started,
    };
  } finally {
    rmSync(folder, {recursive: true, force: true});
  }
}
