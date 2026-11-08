#!/usr/bin/env node

import { readFileSync, realpathSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { executeControl } from './neo-control.mjs';
import { runAgentDiscovery } from './neo-agent-catalog.mjs';
import { buildXChatBootstrap, renderXChatBootstrap } from './xchat-bootstrap.mjs';
import { runNeoMcpToken } from './neo-mcp-token.mjs';
import { runLocalEscalation, localEscalationConfig } from './neo-local-escalation.mjs';
import { prepareExperience, storeExperience, listExperience, toolsObserved, renderTaughtExperience } from './neo-escalation-experience.mjs';
import { runLearningSession } from './neo-escalation-learn.mjs';
import { beginChallenge, finishChallenge, checkpointChallenge, listChallenges } from './neo-escalation-challenges.mjs';
import { runEscalationSelfTest } from './neo-escalation-self-test.mjs';
import {withGlobalEscalationLock, escalationLockConfig} from './neo-escalation-lock.mjs';
import { runComputerUseCli } from './neo-mcp-local.mjs';
import { loadWorkspaceConfig } from './workspace-config.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const AGENT_PATH = resolve(ROOT, 'agents/escalation.agent.md');
const DEFAULT_NEEDS_USER_PATH = resolve(ROOT, 'agents/escalation-needs-user.md');

function escalationLockOptions() {
  return {...escalationLockConfig(),
    onWaiting: ()=>process.stderr.write('Neo Escalation resource busy; waiting for the exclusive model slot.\n'),
  };
}


function usage() {
  return `Usage:
  neo escalation --handoff-file PATH [options]
  neo escalation test              Run local-agent tool-use and model-cleanup self-test
  neo escalation learn             Teach the local agent interactively, review and remember a lesson
  neo escalation cases [--search TEXT] [--limit N]  List private deduplicated scenarios
  neo escalation challenges [--search TEXT] [--limit N]  Inspect durable challenges and attempts
  neo status|doctor
  neo agent list [--project PATH] [--source project|shared|global|agency]\n  neo agent search QUERY [--project PATH] [--source ...] [--limit N]\n  neo project list|resolve NAME|setup-agent NAME
  neo project run (--url HTTPS_URL | --path ABSOLUTE_RUN_DIR) --project NAME [--dry-run] [--no-review]
  neo project review checkpoint --project NAME --path ABSOLUTE_RUN_DIR --stage producer\n  neo project tts (--text TEXT | --text-file PATH) --output ABSOLUTE.m4a [--voice Tingting] [--rate 200] [--node local]
  neo workspace show
  neo skill list [--project PATH]|package SKILL_DIR OUTPUT.zip
  neo bootstrap [--json] [--project PATH]
  neo eval run --project NAME [--case ID | --dag [--smoke]] [--model MODEL] [--dry-run]
  neo eval list --project NAME
  neo eval audit
  neo service list|status NAME|start|stop|restart NAME --apply
  neo mcp token issue (--stdout | --output ABSOLUTE_PATH) [--origin HTTPS_URL] [--client-name NAME]
  neo mcp token revoke --file ABSOLUTE_PATH [--origin HTTPS_URL]
  neo computer-use help | call COMMAND [--args-file PATH]

Options:
  --handoff-file PATH            Required handoff file containing the full escalation request
  --on-needs-user-file PATH      Optional notification-policy override file
  --cwd PATH                     Original working directory for the task (default: current directory)
  --correlation-id ID            Stable opaque task ID to associate retries

Runtime environment:
  NEO_ESCALATION_ENGINE            llama (default), mlx, external
  NEO_ESCALATION_MODEL             Model repo or local model file path
  NEO_ESCALATION_CONTEXT           Context tokens (default 65536)
  NEO_ESCALATION_AGENT_COMMAND     Hermes executable (default hermes)
  NEO_ESCALATION_SERVER_COMMAND    Local inference server executable
  NEO_ESCALATION_BASE_URL          Loopback /v1 URL for external engine
  NEO_ESCALATION_CHALLENGES_DIR     Private challenge ledger location
  NEO_ESCALATION_LOCK_DIR           Per-host exclusive-lock directory (default ~/.local/state/neo/escalation)
  NEO_ESCALATION_LOCK_WAIT_SECONDS  Queue timeout (default 3600)
`;
}

function valueFor(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

export function readRequiredTextFile(path, label = 'file') {
  let content;
  try {
    content = readFileSync(path, 'utf8');
  } catch (error) {
    throw new Error(`${label} could not be read: ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!content.trim()) throw new Error(`${label} is empty: ${path}`);
  return content;
}

function fileOption(args, name) {
  const file = valueFor(args, name);
  if (file === undefined) return undefined;
  if (file === '-') throw new Error(`${name} requires a file path; stdin is not supported`);
  return readRequiredTextFile(file, name);
}

export function parseEscalationArgs(args, options = {}) {
  const allowed = new Set(['--handoff-file', '--on-needs-user-file', '--cwd', '--correlation-id']);
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    if (!allowed.has(name)) throw new Error(`unknown escalation option: ${name}; use --handoff-file PATH`);
  }
  const request = {
    handoff: fileOption(args, '--handoff-file'),
    onNeedsUser: fileOption(args, '--on-needs-user-file') ?? readRequiredTextFile(options.defaultNeedsUserPath ?? DEFAULT_NEEDS_USER_PATH, 'default needs-user policy'),
    cwd: valueFor(args, '--cwd') ?? process.cwd(),
    correlationId: valueFor(args, '--correlation-id')
  };
  if (!request.handoff || !request.handoff.trim()) throw new Error('escalation requires --handoff-file PATH');
  return request;
}

function validateResult(result) {
  if (!result || typeof result !== 'object') throw new Error('Escalation did not return a JSON object');
  if (!['resolved', 'needs_user', 'failed'].includes(result.status)) throw new Error(`invalid escalation status: ${result.status}`);
  if (typeof result.summary !== 'string' || !result.summary.trim()) throw new Error('escalation result requires summary');
  if (result.status === 'needs_user' && (typeof result.user_action !== 'string' || !result.user_action.trim())) {
    throw new Error('needs_user result requires user_action');
  }
  return result;
}

async function main(argv) {
  const [command, ...args] = argv;
  if (!command || command === '--help' || command === '-h') {
    process.stdout.write(usage());
    return 0;
  }
  if (command === 'bootstrap') {
    const json = args.includes('--json');
    const filtered = args.filter(arg => arg !== '--json');
    if (filtered.length && !(filtered.length === 2 && filtered[0] === '--project' && filtered[1] && !filtered[1].startsWith('-')))
      throw new Error('usage: neo bootstrap [--json] [--project PATH]');
    const manifest = buildXChatBootstrap({ project: filtered[1] });
    process.stdout.write(json ? JSON.stringify(manifest, null, 2) + '\n' : renderXChatBootstrap(manifest));
    return 0;
  }
  if (command === 'agent') {
    process.stdout.write(JSON.stringify(runAgentDiscovery(args, { neoRoot: loadWorkspaceConfig().neoRoot }), null, 2) + '\n');
    return 0;
  }
  if (command === 'mcp') {
    if (args[0] !== 'token') throw new Error('usage: neo mcp token issue|revoke');
    if (args.includes('--help') || args.includes('-h')) {
      process.stdout.write(usage());
      return 0;
    }
    const outcome = await runNeoMcpToken(args.slice(1));
    // Only the explicit --stdout mode prints the temporary credential.
    process.stdout.write('access_token' in outcome ? outcome.access_token + '\n' : JSON.stringify(outcome, null, 2) + '\n');
    return 0;
  }
  if (command === 'computer-use') {
    const result = await runComputerUseCli(args);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return result.isError ? 2 : 0;
  }
  if (command === 'eval') {
    const [subcommand = 'run', ...options] = args;
    if (['--help', '-h'].includes(subcommand)) { process.stdout.write(usage()); return 0; }
    const neoSourceRoot = existsSync(resolve(ROOT, 'scripts/eval-project-worker-prompts.mjs'))
      ? ROOT : loadWorkspaceConfig().neoRoot;
    const script = subcommand === 'audit'
      ? resolve(neoSourceRoot, 'scripts/audit-project-worker-evals.mjs')
      : resolve(neoSourceRoot, 'scripts/eval-project-worker-prompts.mjs');
    if (!['run', 'list', 'audit'].includes(subcommand)) throw new Error('usage: neo eval run|list|audit');
    if (subcommand === 'audit' && options.length) throw new Error('usage: neo eval audit');
    const result = spawnSync(process.execPath, [script, ...(subcommand === 'list' ? ['--list'] : []), ...options], {
      cwd: process.cwd(), stdio: 'inherit'
    });
    if (result.error) throw result.error;
    return result.status ?? 1;
  }
  if (['status', 'doctor', 'project', 'workspace', 'skill', 'service'].includes(command)) return executeControl([command, ...args]);
  if (command !== 'escalation') throw new Error(`unknown neo command: ${command}`);
  if (args[0] === 'learn') {
    if (args.length !== 1) throw new Error('usage: neo escalation learn');
    if (!process.stdin.isTTY) throw new Error('neo escalation learn requires an interactive terminal (TTY)');
    const config = localEscalationConfig();
    await withGlobalEscalationLock(
      ({registerOwnedPid})=>runLearningSession({config,onServerStarted:registerOwnedPid}),
      escalationLockOptions(),
    );
    return 0;
  }
  if (args[0] === 'test') {
    if (args.length !== 1) throw new Error('usage: neo escalation test');
    const result = await withGlobalEscalationLock(
      ({registerOwnedPid})=>runEscalationSelfTest({
        agentPrompt: readFileSync(AGENT_PATH, 'utf8'), onOwnedServerPid: registerOwnedPid,
      }),
      escalationLockOptions(),
    );
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return 0;
  }
  if (args[0] === 'cases' || args[0] === 'challenges') {
    const options = args.slice(1);
    const kind = args[0];
    if (options.length % 2 !== 0 || options.some((arg, i) => i % 2 === 0 && !['--search', '--limit'].includes(arg))) {
      throw new Error(`usage: neo escalation ${kind} [--search TEXT] [--limit N]`);
    }
    const filter = {
      search: valueFor(options, '--search') || '',
      limit: valueFor(options, '--limit') === undefined ? 30 : Number(valueFor(options, '--limit')),
    };
    process.stdout.write(JSON.stringify(kind === 'cases' ? listExperience(filter) : listChallenges(filter), null, 2) + '\n');
    return 0;
  }
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(usage());
    return 0;
  }
  const request = parseEscalationArgs(args);
  request.learnedLessons = renderTaughtExperience(request.handoff);
  // Challenge and start event must be durable BEFORE model initialization.
  // A killed process then leaves a diagnosable unfinished attempt instead of
  // an empty/unclassified experience record.
  const challenge = beginChallenge(request);
  const backend = 'local';
  let phase = 'preflight';
  checkpointChallenge(challenge, phase);
  let config;
  let result;
  let captured;
  let executionError;
  const progress = {tools:new Set(), calls:0, failures:0};
  try {
    config = localEscalationConfig();
    phase = 'resource_lock';
    checkpointChallenge(challenge, phase);
    result = validateResult(await withGlobalEscalationLock(
      ({registerOwnedPid})=>runLocalEscalation(request, {
        config,
        onServerStarted: registerOwnedPid,
        agentPrompt: readFileSync(AGENT_PATH, 'utf8'),
        playbookPrompt: readFileSync(resolve(ROOT, 'agents/neo-escalation-playbook.md'), 'utf8'),
        experiencePrompt: readFileSync(resolve(ROOT, 'agents/escalation-experience.md'), 'utf8'),
        onExperience: payload => { captured = payload; },
        onProgress: entry => {
          if (entry.stage && entry.stage !== phase) {
            phase = entry.stage;
            checkpointChallenge(challenge, phase);
          }
          if (entry.tool) {
            progress.calls++;
            if (entry.ok === false) progress.failures++;
            if (['shell','webhelm','computer-use','skills'].includes(entry.tool)) progress.tools.add(entry.tool);
          }
        },
      }),
      escalationLockOptions(),
    ));
  } catch (error) {
    executionError = error;
  }
  // Model writes its own sanitized case candidate into final JSON. Neo only
  // validates and stores that candidate, or a minimal failure if it crashed.
  // Never repeat a potentially mutating task when recording fails.
  let experienceId;
  try {
    const experience = prepareExperience({
      handoff: request.handoff,
      result: executionError ? {status:'failed'} : result,
      experience: captured?.experience,
      captureMethod: captured?.captureMethod,
      events: captured?.events,
      backend,
      engine: config?.engine ?? 'other',
      model: config?.model ?? 'unknown',
      error: executionError,
    });
    storeExperience(experience);
    experienceId = experience.id;
  } catch (error) {
    process.stderr.write(`Escalation experience could not be saved (task will not be retried): ${error.message}\n`);
  }
  try {
    finishChallenge(challenge, {
      result:captured?.rawResult ?? result, error:executionError, phase,
      observation: captured?.events?.length ? toolsObserved(captured.events) : {
        tools:[...progress.tools].sort(),calls:progress.calls,failures:progress.failures,
      },
      experienceId,
    });
  } catch (error) {
    process.stderr.write('Escalation challenge finish event could not be saved; start event remains for recovery.\n');
    if (!executionError) executionError = error;
  }
  if (executionError) throw executionError;
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.status === 'failed' ? 2 : 0;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
