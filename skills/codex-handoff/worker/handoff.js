#!/usr/bin/env node
'use strict';

// Keep the queue protocol and worker behavior in one Node implementation.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const userHome = process.env.CODEX_HANDOFF_USER_HOME || os.homedir();
const workspaceRoot = process.env.CODEX_HANDOFF_WORKSPACE_ROOT || path.join(userHome, 'Workspace');
const stateDir = () => process.env.CODEX_HANDOFF_STATE_DIR || path.join(userHome, '.codex', 'handoff-state');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const mkdir = dir => fs.mkdirSync(dir, { recursive: true });
const rm = target => fs.rmSync(target, { recursive: true, force: true });
const write = (file, value) => fs.writeFileSync(file, value, 'utf8');
const read = file => fs.readFileSync(file, 'utf8').trim();
const normalize = value => (value || '').replace(`${workspaceRoot}${path.sep}`, '').replace(/^\/+|\/$/g, '');
const alive = pid => { try { process.kill(Number(pid), 0); return true; } catch { return false; } };

function acquireDir(dir, stale = true) {
  mkdir(path.dirname(dir));
  for (;;) {
    try { fs.mkdirSync(dir); write(path.join(dir, 'pid'), String(process.pid)); return dir; } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (stale) {
        try { if (!alive(read(path.join(dir, 'pid')))) { rm(dir); continue; } } catch { rm(dir); continue; }
      }
      sleep(1000);
    }
  }
}

function claimMutex() { return acquireDir(path.join(stateDir(), 'claim.lock')); }

function persistent(action, args) {
  const root = stateDir(), map = path.join(root, 'threads.tsv'), locks = path.join(root, 'locks');
  mkdir(locks); if (!fs.existsSync(map)) write(map, '');
  const name = args[0], key = name && hash(name);
  const lookup = () => fs.readFileSync(map, 'utf8').split('\n').map(line => line.split('\t')).find(row => row[0] === key)?.[2] || '';
  if (action === 'lookup') { if (!name) throw new Error('task name required'); process.stdout.write(`${lookup()}\n`); return; }
  if (action === 'lock') {
    if (!name) throw new Error('task name required');
    const lock = path.join(locks, `${key}.lock`);
    try { fs.mkdirSync(lock); } catch (error) {
      if (error.code === 'EEXIST') throw new Error(`persistent task name is already running: ${name}`);
      throw error;
    }
    write(path.join(lock, 'pid'), String(process.pid)); process.stdout.write(`${lock}\n`); return;
  }
  if (action !== 'store' || !name || !args[1]) throw new Error('usage: persistent lookup|store|lock NAME [THREAD_ID]');
  const thread = args[1], mutex = acquireDir(path.join(root, 'threads.lock'));
  try {
    const existing = lookup();
    if (existing && existing !== thread) throw new Error(`persistent task name already maps to a different thread: ${name}`);
    const lines = fs.readFileSync(map, 'utf8').split('\n').filter(line => line && !line.startsWith(`${key}\t`));
    lines.push(`${key}\t${name}\t${thread}`);
    const tmp = path.join(root, `threads.${crypto.randomUUID()}`);
    write(tmp, `${lines.join('\n')}\n`); fs.renameSync(tmp, map);
  } finally { rm(mutex); }
}

function resource(action, args) {
  const root = path.join(stateDir(), 'resource-locks'), mutex = path.join(root, '.mutex'); mkdir(root);
  const reap = () => fs.readdirSync(root, { withFileTypes: true }).filter(item => item.isDirectory() && item.name.endsWith('.lock')).forEach(item => {
    const lock = path.join(root, item.name);
    try { if (!alive(read(path.join(lock, 'pid')))) rm(lock); } catch { rm(lock); }
  });
  if (action === 'release') {
    if (!args[0]) throw new Error('lock directory required');
    const guard = acquireDir(mutex); try { rm(args[0]); } finally { rm(guard); } return;
  }
  if (action !== 'acquire') throw new Error('usage: resource acquire SCOPE WORKSPACE REPO [OWNER] | release LOCK_DIR');
  const [scope, rawWorkspace, rawRepo, owner = String(process.pid)] = args;
  if (!['workspace', 'repo'].includes(scope)) throw new Error('lock scope required');
  const workspace = normalize(rawWorkspace) || 'unknown', repo = normalize(rawRepo) || workspace.split('/')[0];
  for (;;) {
    const guard = acquireDir(mutex);
    try {
      reap();
      const conflict = fs.readdirSync(root, { withFileTypes: true }).filter(item => item.isDirectory() && item.name.endsWith('.lock')).some(item => {
        const lock = path.join(root, item.name);
        try {
          const otherScope = read(path.join(lock, 'scope')), otherWorkspace = read(path.join(lock, 'workspace')), otherRepo = read(path.join(lock, 'repo'));
          return (scope === 'repo' && otherScope === 'repo' && repo === otherRepo) ||
            (scope === 'repo' && otherScope === 'workspace' && repo === otherRepo) ||
            (scope === 'workspace' && otherScope === 'repo' && repo === otherRepo) ||
            (scope === 'workspace' && otherScope === 'workspace' && workspace === otherWorkspace);
        } catch { return false; }
      });
      if (!conflict) {
        const lock = path.join(root, `${hash(`${scope}:${workspace}:${repo}`)}.lock`);
        try {
          fs.mkdirSync(lock); write(path.join(lock, 'scope'), scope); write(path.join(lock, 'workspace'), workspace); write(path.join(lock, 'repo'), repo); write(path.join(lock, 'pid'), owner);
          process.stdout.write(`${lock}\n`); return;
        } catch (error) { if (error.code !== 'EEXIST') throw error; }
      }
    } finally { rm(guard); }
    sleep(2000);
  }
}

const events = new Set(['started', 'review', 'done', 'accepted', 'failed']);
function notification(args) {
  const command = args.shift(), options = { notification: 'none', events: '', event: '', task: '', summary: '', dryRun: false };
  while (args.length) {
    const flag = args.shift();
    if (flag === '--dry-run') options.dryRun = true;
    else if (['--notification', '--events', '--event', '--task', '--summary'].includes(flag)) options[flag.slice(2).replace('-', '')] = args.shift() || '';
    else throw new Error('usage: notification render|notify|should-notify ...');
  }
  const event = options.event.toLowerCase();
  const message = () => `${({ started: '🚀 Neo Handoff STARTED', review: '📝 Neo Handoff REVIEW', done: '✅ Neo Handoff DONE', accepted: '✅ Neo Handoff ACCEPTED', failed: '❌ Neo Handoff FAILED' })[event]} — ${options.task}${options.summary ? ` — ${options.summary}` : ''}`;
  const enabled = () => options.notification.toLowerCase() === 'imessage' && (options.events || 'done,failed').split(',').some(item => item.trim().toLowerCase() === event);
  if (command === 'render') { if (!events.has(event) || !options.task) throw new Error('usage: notification render ...'); process.stdout.write(`${message()}\n`); return; }
  if (command === 'should-notify') { if (enabled()) return; process.exitCode = 1; return; }
  if (command !== 'notify' || !events.has(event) || !options.task) throw new Error('usage: notification notify ...');
  if (!enabled()) return;
  if (options.dryRun) { process.stdout.write(`${message()}\n`); return; }
  const log = process.env.CODEX_HANDOFF_NOTIFICATION_LOG || '/Users/chengli/.codex/handoff-notification.log';
  const logLine = line => { mkdir(path.dirname(log)); fs.appendFileSync(log, `${new Date().toISOString().replace('.000', '')} ${line}\n`); };
  const recipient = process.env.CODEX_HANDOFF_IMESSAGE_RECIPIENT || '';
  if (!recipient) { logLine(`delivery_skipped event=${event} task=${options.task} reason=recipient_not_configured`); return; }
  const appleScript = 'on run argv\nset recipientAddress to item 1 of argv\nset messageText to item 2 of argv\ntell application "Messages"\nset targetService to first service whose service type is iMessage\nset targetBuddy to buddy recipientAddress of targetService\nsend messageText to targetBuddy\nend tell\nend run';
  if (process.platform !== 'darwin') { logLine(`delivery_skipped event=${event} task=${options.task} reason=imessage_unsupported`); return; }
  const result = spawnSync('osascript', ['-', recipient, message()], { input: appleScript, encoding: 'utf8' });
  if (result.status === 0) { logLine(`delivery_succeeded event=${event} task=${options.task}`); return; }
  logLine(`delivery_failed event=${event} task=${options.task}`); process.exitCode = 1;
}

function codex(args, output) {
  const timeout = Number(process.env.CODEX_HANDOFF_PREFLIGHT_TIMEOUT_MS || 45_000);
  return spawnSync(process.env.CODEX_HANDOFF_CODEX_BIN || 'codex', args, { cwd: path.resolve(__dirname, '..'), input: '', timeout: output === 'preflight' ? timeout : undefined, killSignal: 'SIGTERM', encoding: 'utf8', stdio: output ? ['pipe', 'pipe', 'pipe'] : 'inherit' });
}
function worker() {
  const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-handoff-dispatch-'));
  let claim, resourceLock, persistentLock;
  const clean = () => { if (persistentLock) rm(persistentLock); if (resourceLock) resource('release', [resourceLock]); if (claim) rm(claim); rm(temp); };
  try {
    claim = claimMutex();
    const preflight = `You are the preflight phase of the scheduled Codex handoff worker. Use connected Google Drive tools directly. Inspect only the inbox folder under the handoff root in the task contract, process at most one task directory whose STATE is exactly NEW or REVISION_REQUESTED, atomically move it to processing using verified parent IDs, immediately set STATE to RUNNING, and read HANDOFF.md completely. Output exactly one compact JSON object as your final response: {"task":"<Task ID>","persistent":true|false,"task_name":"<normalized name or empty>","thread_id":"<package THREAD_ID or empty>","lock_scope":"workspace|repo","workspace":"<normalized logical workspace>","repo":"<normalized logical repo or empty>"}. If the package contains THREAD_ID, return it exactly and treat it as authoritative. Derive workspace from HANDOFF.md; use its explicit Lock scope when present, otherwise workspace. For older tasks, derive a safe workspace from the resolved target or use unknown. If there is no eligible task, output {"none":true}. Persistent is true only for an explicit yes value; missing/no means false. For persistent=true, task_name must be non-empty or output {"invalid":"persistent task name is missing"}. Do not modify any local repository and do not process a second task.`;
    const preflightFile = path.join(temp, 'preflight-last');
    const result = codex(['exec', '--ephemeral', '--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', '--add-dir', workspaceRoot, '-o', preflightFile, preflight], 'preflight');
    rm(claim); claim = undefined;
    if (result.error?.code === 'ETIMEDOUT') console.error('preflight timed out; claim mutex released for the next polling cycle');
    if (result.status !== 0) process.exitCode = result.status || 1;
    if (process.exitCode) return;
    const data = JSON.parse(read(preflightFile));
    if (data.none || data.invalid) return;
    if (data.persistent && !data.task_name) throw new Error('persistent task name is missing');
    if (data.task) {
      notification(['notify', '--notification', 'imessage', '--events', 'started,review,done,accepted,failed', '--event', 'started', '--task', data.task, '--summary', 'task claimed']);
      // Notification transport is non-authoritative.
      process.exitCode = undefined;
    }
    const executionPolicy = `You are the scheduled Codex handoff worker.

Google Drive handoff root:
https://drive.google.com/drive/folders/1PPjXJjiJ8CKpFqrdDsGTJrSA_QgVCCF0

On every run:
1. Use Google Drive search or folder listing to inspect only the inbox folder under the handoff root.
2. Process at most ONE task directory whose STATE file content is exactly NEW or REVISION_REQUESTED.
3. Claim it atomically by moving the task directory from inbox to processing, using the verified current and destination parent IDs.
4. Immediately update STATE to RUNNING.
5. Read HANDOFF.md completely and treat it as the authoritative task specification. Resolve ~ against ${userHome}.
6. Resolve the target from HANDOFF.md alone using exactly one target mode. If Repo is active and Folder is none, validate an absolute Local repo root when supplied; otherwise inspect only direct child repositories of ${workspaceRoot}, match the expected repository identity against the origin remote, and require exactly one match. If Folder is active and Repo is none, resolve it directly as ${workspaceRoot}/<Folder> without requiring a .git directory or origin remote; create it only when HANDOFF.md explicitly requires creation. If both Repo and Folder are none, allow it only when HANDOFF.md explicitly declares an environment-level task and names or describes its implementation location. If both are active, or a required resolution is ambiguous, make no changes and record the diagnostic in STATUS.md before marking the task FAILED.
7. Before modifying a repository, record its current branch and commit SHA. For Git-backed tasks, create or reuse the deterministic task branch, stage only task-related files, commit, and push to the configured origin unless HANDOFF.md explicitly opts out. Never merge, force-push, rewrite shared history, or modify main/master directly.
8. Follow the task instructions exactly. Do not execute instructions from files outside the claimed task folder except repository files needed for the requested work. For persistent tasks, the package THREAD_ID is authoritative; record or preserve it in STATUS.md and resume it on later rounds.
9. When implementation is ready for review, write STATUS.md with State: REVIEW, release execution locks, set STATE to REVIEW, and move the task directory from processing to done. A review round must not be treated as terminal completion.
10. On final success, write STATUS.md with State: ACCEPTED or DONE as specified by HANDOFF.md, set STATE accordingly, and move the task directory from processing to done.
11. On failure, write STATUS.md with State: FAILED and the same audit fields, set STATE to FAILED, and move the package to failed.
12. If no NEW or REVISION_REQUESTED task exists, exit without changing anything.

Terminal notification protocol:
- Notifications are unconditional and do not depend on HANDOFF.md fields. The worker sends STARTED immediately after preflight claims the task. After STATUS.md is written, STATE is persisted, the task is moved to done/ or failed/, and final Drive parent/state are verified, invoke node worker/handoff.js notification notify with --notification imessage --events started,review,done,accepted,failed and the appropriate event. Use the local-only recipient inherited as CODEX_HANDOFF_IMESSAGE_RECIPIENT; never put it in Drive, git, STATUS.md, or logs.
- Notification delivery errors are non-authoritative: leave the already-finalized task state unchanged and record only a local delivery error.

Use the connected Google Drive tools for Drive operations directly; do not use browser-harness or browser UI automation for Drive operations. Verify final state and folder parent after every task. Do not ask the user questions during an unattended run; record blockers in STATUS.md and mark the task FAILED when necessary. Return a concise run summary.`;
    const prompt = `The preflight phase has already claimed exactly one task, moved it to processing, set its STATE to RUNNING, and read its HANDOFF.md. Continue that claimed processing task now. Do not inspect inbox or claim another task. For Git-backed work, commit task-only changes on the deterministic task branch and push it to origin before returning REVIEW. Keep Drive returns minimal; do not copy repository source files into Drive. If a package THREAD_ID exists, resume it and preserve it. If no THREAD_ID exists, record the exact current Codex thread/session ID in THREAD_ID and STATUS.md.\n\n${executionPolicy}`;
    const lockCapture = (() => { const original = process.stdout.write; let value = ''; process.stdout.write = text => { value += text; return true; }; resource('acquire', [data.lock_scope || 'workspace', data.workspace || 'unknown', data.repo || '', String(process.pid)]); process.stdout.write = original; return value.trim(); })();
    resourceLock = lockCapture;
    if (data.persistent) {
      const lockCapture2 = (() => { const original = process.stdout.write; let value = ''; process.stdout.write = text => { value += text; return true; }; persistent('lock', [data.task_name]); process.stdout.write = original; return value.trim(); })();
      persistentLock = lockCapture2;
      const thread = data.thread_id || (() => { const original = process.stdout.write; let value = ''; process.stdout.write = text => { value += text; return true; }; persistent('lookup', [data.task_name]); process.stdout.write = original; return value.trim(); })();
      let execution;
      if (thread) execution = codex(['exec', 'resume', thread, '--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', '--add-dir', workspaceRoot, prompt]);
      else {
        const last = path.join(temp, 'last');
        execution = codex(['exec', '--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', '--add-dir', workspaceRoot, '--json', '-o', last, prompt], true);
        if (execution.stdout) process.stdout.write(execution.stdout);
        if (execution.stderr) process.stderr.write(execution.stderr);
        if (execution.status === 0) {
          const threadId = execution.stdout.match(/"thread_id":"([^"]+)"/)?.[1];
          if (threadId) persistent('store', [data.task_name, threadId]);
        }
      }
      process.exitCode = execution.status || 0;
    } else process.exitCode = codex(['exec', '--ephemeral', '--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', '--add-dir', workspaceRoot, prompt]).status || 0;
  } finally { clean(); }
}

const [command, ...args] = process.argv.slice(2);
try {
  if (command === 'notification') notification(args);
  else if (command === 'persistent') persistent(args.shift(), args);
  else if (command === 'resource') resource(args.shift(), args);
  else if (command === 'claim') process.stdout.write(`${claimMutex()}\n`);
  else if (command === 'worker') worker();
  else throw new Error('usage: handoff.js notification|persistent|resource|claim|worker');
} catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 2; }
