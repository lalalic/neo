#!/usr/bin/env node

import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const AGENT_PATH = resolve(ROOT, 'agents/escalation.agent.md');
const SCHEMA_PATH = resolve(ROOT, 'agents/escalation-result.schema.json');
const DEFAULT_NEOY_MCP_URL = process.env.NEOY_MCP_URL ?? 'http://127.0.0.1:6767/mcp';

const DEFAULT_ON_NEEDS_USER = `If this escalation genuinely requires the human user:

1. Prefer using wechat-bro to send the notification to File Helper.
2. If WeChat-bro or File Helper is unavailable or delivery fails, use iMessage to send the message to the user themself.
3. Keep the message concise and phone-readable. Use a short bullet list or a small ASCII status block, not a paragraph.
4. Include only the blocked item, the single exact user action required, and how completion will be detected.
5. Verify delivery when possible.`;

function usage() {
  return `Usage:
  neo escalation --handoff-file PATH [options]

Options:
  --handoff-file PATH            Required handoff file containing the full escalation request
  --on-needs-user-file PATH      Optional notification-policy override file
  --cwd PATH                     Working directory for local Codex (default: current directory)
  --codex-command PATH           Override Codex executable (default: codex)
`;
}

function valueFor(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

function fileOption(args, name) {
  const file = valueFor(args, name);
  if (file === undefined) return undefined;
  if (file === '-') throw new Error(`${name} requires a file path; stdin is not supported`);
  return readFileSync(file, 'utf8');
}

export function parseEscalationArgs(args) {
  const allowed = new Set(['--handoff-file', '--on-needs-user-file', '--cwd', '--codex-command']);
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    if (!allowed.has(name)) throw new Error(`unknown escalation option: ${name}`);
  }
  const request = {
    handoff: fileOption(args, '--handoff-file'),
    onNeedsUser: fileOption(args, '--on-needs-user-file'),
    cwd: valueFor(args, '--cwd') ?? process.cwd(),
    codexCommand: valueFor(args, '--codex-command') ?? 'codex'
  };
  if (request.onNeedsUser === undefined) request.onNeedsUser = DEFAULT_ON_NEEDS_USER;
  if (!request.handoff || !request.handoff.trim()) throw new Error('escalation requires --handoff-file PATH');
  return request;
}

export function buildEscalationPrompt(request, agentContract = readFileSync(AGENT_PATH, 'utf8')) {
  return `${agentContract.trim()}

# Escalation request

${JSON.stringify({
    handoff: request.handoff,
    on_needs_user: request.onNeedsUser ?? null
  }, null, 2)}
`;
}

export function codexArgs(request) {
  const neoyMcpUrl = request.neoyMcpUrl ?? DEFAULT_NEOY_MCP_URL;
  return [
    '-c', `mcp_servers.neoy.url=${JSON.stringify(neoyMcpUrl)}`,
    '--sandbox', 'danger-full-access',
    '--ask-for-approval', 'never',
    'exec',
    '--skip-git-repo-check',
    '--output-schema', SCHEMA_PATH,
    '-C', request.cwd,
    '-'
  ];
}

function validateResult(result) {
  if (!result || typeof result !== 'object') throw new Error('Codex did not return a JSON object');
  if (!['resolved', 'needs_user', 'failed'].includes(result.status)) throw new Error(`invalid escalation status: ${result.status}`);
  if (typeof result.summary !== 'string' || !result.summary.trim()) throw new Error('escalation result requires summary');
  if (result.status === 'needs_user' && (typeof result.user_action !== 'string' || !result.user_action.trim())) {
    throw new Error('needs_user result requires user_action');
  }
  return result;
}

export function runEscalation(request, options = {}) {
  const spawn = options.spawnSyncImpl ?? spawnSync;
  const result = spawn(request.codexCommand ?? 'codex', codexArgs(request), {
    cwd: request.cwd,
    input: buildEscalationPrompt(request, options.agentContract),
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim();
    throw new Error(`local Codex escalation failed (${result.status})${detail ? `: ${detail}` : ''}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(String(result.stdout).trim());
  } catch {
    throw new Error(`local Codex escalation returned invalid JSON: ${String(result.stdout).trim()}`);
  }
  return validateResult(parsed);
}

function main(argv) {
  const [command, ...args] = argv;
  if (!command || command === '--help' || command === '-h') {
    process.stdout.write(usage());
    return 0;
  }
  if (command !== 'escalation') throw new Error(`unknown neo command: ${command}`);
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(usage());
    return 0;
  }
  const result = runEscalation(parseEscalationArgs(args));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.status === 'failed' ? 2 : 0;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
