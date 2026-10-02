#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const AGENT_PATH = resolve(ROOT, 'agents/escalation.agent.md');
const SCHEMA_PATH = resolve(ROOT, 'agents/escalation-result.schema.json');

function usage() {
  return `Usage:
  neo escalation --intent TEXT --blocked-on TEXT [options]

Options:
  --intent TEXT | --intent-file PATH
  --blocked-on TEXT | --blocked-on-file PATH
  --context TEXT | --context-file PATH
  --on-needs-user TEXT | --on-needs-user-file PATH
  --cwd PATH                    Working directory for local Codex (default: current directory)
  --codex-command PATH          Override Codex executable (default: codex)
`;
}

function valueFor(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

function textOption(args, inlineName, fileName) {
  const inline = valueFor(args, inlineName);
  const file = valueFor(args, fileName);
  if (inline && file) throw new Error(`${inlineName} and ${fileName} are mutually exclusive`);
  if (file) return file === '-' ? readFileSync(0, 'utf8') : readFileSync(file, 'utf8');
  return inline;
}

export function parseEscalationArgs(args) {
  const request = {
    intent: textOption(args, '--intent', '--intent-file'),
    blockedOn: textOption(args, '--blocked-on', '--blocked-on-file'),
    context: textOption(args, '--context', '--context-file'),
    onNeedsUser: textOption(args, '--on-needs-user', '--on-needs-user-file'),
    cwd: valueFor(args, '--cwd') ?? process.cwd(),
    codexCommand: valueFor(args, '--codex-command') ?? 'codex'
  };
  if (!request.intent) throw new Error('escalation requires --intent or --intent-file');
  if (!request.blockedOn) throw new Error('escalation requires --blocked-on or --blocked-on-file');
  return request;
}

export function buildEscalationPrompt(request, agentContract = readFileSync(AGENT_PATH, 'utf8')) {
  return `${agentContract.trim()}

# Escalation request

${JSON.stringify({
    intent: request.intent,
    blocked_on: request.blockedOn,
    context: request.context ?? null,
    on_needs_user: request.onNeedsUser ?? null
  }, null, 2)}
`;
}

export function codexArgs(request) {
  return [
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
