import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { generateExperience } from './neo-escalation-experience.mjs';

const DEFAULT_GGUF = 'unsloth/Qwen3.5-4B-GGUF:Q4_K_M';
const DEFAULT_MLX = 'mlx-community/Qwen3.5-4B-MLX-4bit';
const DEFAULT_CONTEXT = 65536;
const DEFAULT_BUDGET_SECONDS = 900;
const DEFAULT_MAX_TURNS = 24;
const DEFAULT_STARTUP_MS = 900_000;

export function localEscalationConfig(env = process.env) {
  const engine = env.NEO_ESCALATION_ENGINE || 'llama';
  if (!['llama', 'mlx', 'external'].includes(engine)) throw new Error('NEO_ESCALATION_ENGINE must be llama, mlx, or external');
  const model = env.NEO_ESCALATION_MODEL || (engine === 'mlx' ? DEFAULT_MLX : DEFAULT_GGUF);
  const context = Number(env.NEO_ESCALATION_CONTEXT || DEFAULT_CONTEXT);
  const budgetSeconds = Number(env.NEO_ESCALATION_BUDGET_SECONDS || DEFAULT_BUDGET_SECONDS);
  const maxTurns = Number(env.NEO_ESCALATION_MAX_TURNS || DEFAULT_MAX_TURNS);
  const startupMs = Number(env.NEO_ESCALATION_STARTUP_MS || DEFAULT_STARTUP_MS);
  if (!Number.isInteger(context) || context < 64000 || context > 262144) throw new Error('NEO_ESCALATION_CONTEXT must be 64000..262144');
  if (!Number.isInteger(budgetSeconds) || budgetSeconds < 10 || budgetSeconds > 7200) throw new Error('NEO_ESCALATION_BUDGET_SECONDS must be 10..7200');
  if (!Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > 500) throw new Error('NEO_ESCALATION_MAX_TURNS must be 1..500');
  if (!Number.isInteger(startupMs) || startupMs < 1000 || startupMs > 1800000) throw new Error('NEO_ESCALATION_STARTUP_MS must be 1000..1800000');
  const baseUrl = env.NEO_ESCALATION_BASE_URL;
  if (engine === 'external' && !/^http:\/\/127\.0\.0\.1:\d+\/v1$/.test(baseUrl || '')) {
    throw new Error('External local inference requires NEO_ESCALATION_BASE_URL=http://127.0.0.1:PORT/v1');
  }
  return {
    engine, model, context, budgetSeconds, maxTurns, startupMs,
    serverCommand: env.NEO_ESCALATION_SERVER_COMMAND || (engine === 'llama' ? 'llama-server' : 'mlx_lm.server'),
    hermesCommand: env.NEO_ESCALATION_AGENT_COMMAND || 'hermes',
    baseUrl,
  };
}

export function serverArguments(config, port) {
  if (config.engine === 'llama') {
    const modelOption = config.model.endsWith('.gguf') && config.model.startsWith('/')
      ? ['-m', config.model] : ['--hf-repo', config.model];
    return [
      ...modelOption, '--no-mmproj', '--jinja', '--host', '127.0.0.1', '--port', String(port),
      '--alias', 'neo-escalation', '-c', String(config.context), '-np', '1', '-ngl', '99',
      '-ctk', 'q8_0', '-ctv', 'q8_0',
    ];
  }
  if (config.engine === 'mlx') {
    return ['--model', config.model, '--host', '127.0.0.1', '--port', String(port)];
  }
  throw new Error('External inference does not start an owned server');
}

export function hermesArguments(queryFile, config, baseUrl, cwd) {
  return [
    'chat', '--oneshot', '--query-file', queryFile,
    '--provider', 'custom', '--base-url', baseUrl, '--api-key', 'no-key-required',
    '--model', 'neo-escalation', '--toolsets', 'terminal,skills',
    '--skills', 'webhelm', '--max-turns', String(config.maxTurns),
    '--quiet', '--format', 'stream-json',
    '--source', 'tool', '--yolo', '--in', cwd,
  ];
}

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function freeTcpPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function ready(port, child, startupMs, fetcher, getStartError = () => null) {
  const end = Date.now() + startupMs;
  while (Date.now() < end) {
    if (getStartError()) throw new Error(`Local model server failed to launch: ${getStartError().message}`);
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('Local model server exited during startup');
    try {
      const response = await fetcher(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) });
      if (response.ok) {
        const body = await response.json().catch(() => ({}));
        if (body.status === 'ok' || body.status === 'ready' || Object.keys(body).length === 0) return;
      }
    } catch { /* not ready yet */ }
    await delay(800);
  }
  throw new Error('Local inference server startup timed out');
}

async function terminate(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  if (child.exitCode !== null || child.signalCode !== null) return;
  await Promise.race([
    new Promise(resolve => child.once('close', resolve)),
    delay(5000),
  ]);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}

async function captureChild(command, args, { cwd, env, timeoutMs }) {
  const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  const cap = 8 * 1024 * 1024;
  child.stdout.on('data', buf => { stdout = (stdout + buf.toString()).slice(-cap); });
  child.stderr.on('data', buf => { stderr = (stderr + buf.toString()).slice(-cap); });
  const outcome = await new Promise(resolve => {
    let forceTimer;
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      forceTimer = setTimeout(() => child.kill('SIGKILL'), 5000);
    }, timeoutMs);
    function finish(result) { clearTimeout(timer); clearTimeout(forceTimer); resolve(result); }
    child.once('error', err => finish({error: err}));
    child.once('close', (code, signal) => finish({code, signal}));
  });
  if (outcome.error) throw outcome.error;
  if (outcome.code !== 0) throw new Error(`Local agent exited ${outcome.code ?? outcome.signal}: ${stderr.slice(-1600) || stdout.slice(-1600)}`);
  return stdout;
}

export function parseLocalSession(output) {
  const lines = String(output || '').trim().split(/\r?\n/).filter(Boolean);
  const events = lines.map(line => {
    try { return JSON.parse(line); }
    catch { throw new Error('Local agent emitted non-JSON event output'); }
  });
  const terminal = events.filter(event => event.type === 'result').at(-1);
  if (!terminal || terminal.exit_code !== 0 || typeof terminal.text !== 'string') {
    throw new Error(`Local agent did not provide a successful terminal result: ${terminal?.error || 'missing result event'}`);
  }
  const text = terminal.text.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  let result;
  try { result = JSON.parse(fenced?.[1] || text); }
  catch { throw new Error('Local agent returned no parseable JSON result'); }
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Local agent result must be a JSON object');
  // Critical evidence gate: the agent cannot report a resolved execution merely
  // by echoing the expected answer without actually calling a tool.
  if (result.status === 'resolved') {
    const toolResults = events.filter(event => event.type === 'tool_result');
    if (!toolResults.length || toolResults.every(event => event.is_error)) {
      throw new Error('Local agent claimed resolved without a successful tool result');
    }
  }
  return { result, events };
}

export function parseLocalAnswer(output) {
  return parseLocalSession(output).result;
}

export function normalizeLocalResult(raw) {
  if (!raw || !['resolved','needs_user','failed'].includes(raw.status)) {
    throw new Error('Local result has an invalid status');
  }
  if (typeof raw.summary !== 'string' || !raw.summary.trim()) {
    throw new Error('Local result needs a meaningful summary');
  }
  let evidence;
  if (Array.isArray(raw.evidence)) {
    evidence = raw.evidence.filter(item => typeof item === 'string' && item.trim());
  } else if (raw.evidence && typeof raw.evidence === 'object') {
    // Small local models occasionally emit a keyed evidence object. Converting
    // its actual values to strings changes format without inventing evidence.
    evidence = Object.entries(raw.evidence).map(([name,value]) => `${name}: ${String(value)}`);
  } else if (typeof raw.evidence === 'string' && raw.evidence.trim()) {
    evidence = [raw.evidence];
  } else {
    evidence = [];
  }
  const reason = raw.reason == null ? null : raw.reason;
  const userAction = raw.user_action == null ? null : raw.user_action;
  const notification = raw.notification == null ? null : raw.notification;
  if (reason !== null && typeof reason !== 'string') throw new Error('Invalid local reason');
  if (userAction !== null && typeof userAction !== 'string') throw new Error('Invalid local user_action');
  if (notification !== null) {
    if (!notification || typeof notification !== 'object' || Array.isArray(notification) ||
        typeof notification.attempted !== 'boolean' ||
        (notification.delivered !== null && typeof notification.delivered !== 'boolean') ||
        (notification.channel !== null && typeof notification.channel !== 'string') ||
        (notification.details !== null && typeof notification.details !== 'string')) {
      throw new Error('Invalid local notification report');
    }
  }
  if (raw.status === 'resolved' && evidence.length === 0) throw new Error('Resolved local escalation has no evidence');
  if (raw.status === 'needs_user' && (!userAction || !userAction.trim())) throw new Error('Needs-user local escalation lacks the required user action');
  return { status:raw.status, summary:raw.summary, reason, user_action:userAction, evidence, notification };
}

/**
 * Start a process-owned inference engine, run one Hermes agent task, then
 * stop the owned engine in a finally block. The model remains on disk only.
 */
export async function runLocalEscalation(request, {
  config = localEscalationConfig(), fetcher = fetch, agentPrompt,
  experiencePrompt = '', onExperience = () => {},
  spawnServer = spawn, runAgent = captureChild, portFactory = freeTcpPort,
  onServerStarted = () => {},
} = {}) {
  const temp = mkdtempSync(join(tmpdir(), 'neo-local-escalation-'));
  let server = null;
  const stopOnSignal = signal => {
    // A cancelled synchronous call must not leave a large model resident.
    if (server && server.exitCode === null && server.signalCode === null) server.kill('SIGTERM');
    process.exit(signal === 'SIGINT' ? 130 : 143);
  };
  const onInterrupt = () => stopOnSignal('SIGINT');
  const onTerminate = () => stopOnSignal('SIGTERM');
  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', onTerminate);
  try {
    writeFileSync(join(temp, 'AGENTS.md'), agentPrompt, {mode: 0o600});
    const query = [
      'Continue this escalation task and obey the local execution rules in AGENTS.md.',
      `Original working directory: ${request.cwd}`,
      'Return exactly one JSON object matching the requested result format.',
      '# Caller handoff', request.handoff,
      '# Notification policy', request.onNeedsUser || '(not supplied)',
    ].join('\n\n');
    const queryFile = join(temp, 'handoff.md');
    writeFileSync(queryFile, query, {mode: 0o600});
    let baseUrl = config.baseUrl;
    if (config.engine !== 'external') {
      const port = await portFactory();
      const logs = join(temp, 'server.log');
      const fs = await import('node:fs');
      const fd = fs.openSync(logs, 'w', 0o600);
      try {
        server = spawnServer(config.serverCommand, serverArguments(config, port), {
          cwd: temp, stdio: ['ignore', fd, fd], env: process.env,
        });
      } finally { fs.closeSync(fd); }
      if (Number.isInteger(server.pid)) onServerStarted(server.pid);
      let startupError = null;
      if (typeof server.on === 'function') server.on('error', error => { startupError = error; });
      await ready(port, server, config.startupMs, fetcher, () => startupError).catch(error => {
        let logTail = '';
        try { logTail = readFileSync(logs, 'utf8').slice(-1200); } catch {}
        throw new Error(`${error.message}; server: ${logTail}`);
      });
      baseUrl = `http://127.0.0.1:${port}/v1`;
    }
    const stdout = await runAgent(
      config.hermesCommand, hermesArguments(queryFile, config, baseUrl, temp),
      { cwd: temp, env: process.env, timeoutMs: (config.budgetSeconds + 60) * 1000 },
    );
    const session = parseLocalSession(stdout);
    const result = normalizeLocalResult(session.result);
    let experience = session.result.experience;
    let captureMethod = 'executor';
    // Let the executor concentrate on real tool use. If it omitted its
    // experience note, ask the same already-loaded local model to summarize
    // the observed outcome in a short, tool-free post-run pass.
    if ((!experience?.scenario_key || !experience?.strategy_key) && experiencePrompt) {
      try {
        experience = await generateExperience({
          baseUrl, experiencePrompt, handoff: request.handoff, result,
          events: session.events, fetcher,
        });
        captureMethod = 'postrun_model';
      } catch {
        experience = undefined; // recorded honestly as an incomplete fallback
      }
    }
    onExperience({experience, events: session.events, result, captureMethod});
    return result;
  } finally {
    await terminate(server);
    process.removeListener('SIGINT', onInterrupt);
    process.removeListener('SIGTERM', onTerminate);
    rmSync(temp, {recursive:true, force:true});
  }
}
