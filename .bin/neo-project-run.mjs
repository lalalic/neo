import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmodSync, closeSync, existsSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, statSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { loadWorkspaceConfig } from './workspace-config.mjs';

const TASK_ID = 'content-run';
const bindingName = '.neo-project-run.json';
const fail = message => { throw new Error(message); };
const isWithin = (base, target) => {
  const rel = relative(base, target);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
};

function parseOptions(args) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    const raw = args[i];
    if (raw === '--help' || raw === '-h') { result.help = true; continue; }
    if (raw === '--dry-run') { if (result.dryRun) fail('--dry-run may be specified only once'); result.dryRun = true; continue; }
    if (raw === '--no-review') { if (result.noReview) fail('--no-review may be specified only once'); result.noReview = true; continue; }
    const match = /^(--(?:url|path|project))(?:=(.*))?$/.exec(raw);
    if (!match) fail(`unknown project run option: ${raw}`);
    const key = match[1].slice(2);
    const value = match[2] ?? args[++i];
    if (!value || value.startsWith('--')) fail(`${match[1]} requires a value`);
    if (result[key] !== undefined) fail(`${match[1]} may be specified only once`);
    result[key] = value;
  }
  if (result.help) return result;
  if (!result.project) fail('project run requires --project NAME');
  if ((result.url === undefined) === (result.path === undefined)) fail('project run requires exactly one of --url URL or --path PATH');
  if (result.noReview && (result.project !== 'vlog' || result.path === undefined)) fail('--no-review is only supported for a private canonical Vlog run');
  return result;
}

function safeProject(neoRoot, name) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) || name === '.' || name === '..') fail('invalid project name');
  const root = realpathSync(neoRoot);
  const gitMarker = join(root, '.git');
  if (existsSync(gitMarker) && !lstatSync(gitMarker).isDirectory()) fail('configured Neo root is a linked Git worktree, not the canonical checkout');
  const project = realpathSync(join(root, name));
  if (!isWithin(root, project) || project === root) fail('project resolves outside the configured Neo workspace');
  for (const file of ['AGENTS.md', 'README.md', 'graph.mmd', 'project.run.json']) {
    const path = join(project, file);
    if (!existsSync(path)) fail(`project is missing required ${file}`);
    const actual = realpathSync(path);
    if (!isWithin(project, actual) || !statSync(actual).isFile()) fail(`project has an invalid ${file}`);
  }
  const declaration = JSON.parse(readFileSync(join(project, 'project.run.json'), 'utf8'));
  if (declaration?.schemaVersion !== 1 || !['url', 'path'].includes(declaration.input?.type)) fail('invalid project run declaration');
  const graph = realpathSync(join(project, 'graph.mmd'));
  if (!isWithin(project, graph)) fail('project graph resolves outside the project');
  return { root, project, graph, declaration };
}

function validateUrl(input, declaration) {
  if (/[\x00-\x20\x7f]/.test(input) || /%(?![A-Fa-f0-9]{2})/.test(input)) fail('URL contains invalid whitespace, control characters, or percent encoding');
  let url;
  try { url = new URL(input); } catch { fail('invalid URL'); }
  if (declaration.input.type !== 'url') fail('project does not accept URL input');
  const allowed = declaration.input.schemes;
  if (!Array.isArray(allowed) || !allowed.includes('https') || url.protocol !== 'https:') fail('URL must use HTTPS');
  if (url.username || url.password) fail('URL credentials are not allowed');
  if (!url.hostname) fail('URL requires a hostname');
  return url;
}

function validateRunPath(input, selected) {
  const declared = selected.declaration.input;
  const canonicalRun = declared.type === 'path' && declared.path?.base === 'runs' && declared.path?.datedRunDirectory === true;
  const resumeUrlRun = declared.type === 'url' && declared.resumePath === true;
  if (!canonicalRun && !resumeUrlRun) fail('project does not accept canonical run path input');
  if (!isAbsolute(input)) fail('--path must be absolute');
  if (input.split(sep).includes('..')) fail('--path must not contain traversal segments');
  const runs = join(selected.project, 'runs');
  let runsReal, target;
  try { runsReal = realpathSync(runs); target = realpathSync(input); } catch { fail('run path does not exist'); }
  if (!isWithin(selected.project, runsReal) || !isWithin(runsReal, target) || target === runsReal) fail('run path must resolve inside this project runs directory');
  const stat = lstatSync(target);
  if (!stat.isDirectory()) fail('--path must name a run directory');
  const runName = basename(target);
  if (!/^\d{4}-\d{2}-\d{2}(?:-[A-Za-z0-9][A-Za-z0-9._-]*)?$/.test(runName)) fail('--path must name a dated canonical run directory');
  if (Number.isNaN(Date.parse(`${runName.slice(0, 10)}T00:00:00Z`)) || new Date(`${runName.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) !== runName.slice(0, 10)) fail('--path must start with a valid calendar date');
  const parent = dirname(target);
  const depth = relative(runsReal, parent).split(sep).filter(Boolean).length;
  if (depth > 1) fail('run path is nested beyond the canonical series layout');
  return target;
}

function writePrivate(file, content) {
  if (existsSync(file)) fail(`refusing to replace existing run file: ${basename(file)}`);
  const temp = join(dirname(file), `.${basename(file)}.${randomUUID()}.tmp`);
  writeFileSync(temp, content, { mode: 0o600, flag: 'wx' });
  chmodSync(temp, 0o600);
  try { linkSync(temp, file); } catch (error) {
    unlinkSync(temp);
    if (error.code === 'EEXIST') fail(`refusing to replace existing run file: ${basename(file)}`);
    throw error;
  }
  unlinkSync(temp);
  chmodSync(file, 0o600);
}

function initializeRun(runDir, projectName, input, sourceUrl, publicationReview = null, noReview = false) {
  const evidence = join(runDir, 'source-reference.json');
  const objective = join(runDir, 'neo-project-run.objective.md');
  const taskInput = join(runDir, 'neo-project-run.input.md');
  const output = join(runDir, 'neo-project-run.result.json');
  const binding = join(runDir, bindingName);
  const testPolicyFile = join(runDir, 'review-mode.json');
  if (noReview) {
    const sourceManifestFile = join(runDir, 'source-manifest.json');
    if (!existsSync(sourceManifestFile)) fail('private no-review Vlog test requires source-manifest.json');
    const sourceManifest = JSON.parse(readFileSync(sourceManifestFile, 'utf8'));
    if (sourceManifest?.source_use?.approved !== true ||
        !/private/i.test(String(sourceManifest?.source_use?.scope || '')))
      fail('private no-review Vlog requires owner-approved private source use');
  }
  if (existsSync(testPolicyFile)) {
    let policy;
    try { policy = JSON.parse(readFileSync(testPolicyFile, 'utf8')); } catch { fail('invalid existing review-mode.json'); }
    if (policy.schemaVersion !== 1 || policy.mode !== 'private-render-test' ||
        policy.publicationAllowed !== false || policy.reviewStatus !== 'UNREVIEWED')
      fail('invalid existing private render test policy');
  }
  if (Boolean(existsSync(testPolicyFile)) !== Boolean(noReview))
    if (existsSync(binding)) fail('Cannot change existing bound Vlog review policy');
    else if (!noReview) fail('Existing private render test must use --no-review');
  if (noReview && !existsSync(testPolicyFile))
    writePrivate(testPolicyFile, JSON.stringify({schemaVersion:1,mode:'private-render-test',
      reviewStatus:'UNREVIEWED',humanReview:'NOT_RUN',specialistReview:'NOT_RUN',publicationAllowed:false},null,2)+'\n');
  if (existsSync(binding)) {
    let saved;
    if ((statSync(binding).mode & 0o077) !== 0) fail('existing run binding is not private; preserving run for review');
    try { saved = JSON.parse(readFileSync(binding, 'utf8')); } catch { fail('existing run binding is unreadable; preserving run for review'); }
    const expected = { evidence, objective, taskInput, output };
    const validJobId = (typeof saved.jobId === 'string' || typeof saved.jobId === 'number') && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(String(saved.jobId));
    if (saved.schemaVersion !== 1 || saved.project !== projectName || saved.runPath !== runDir || saved.taskId !== TASK_ID || !validJobId ||
      Object.entries(expected).some(([key, value]) => saved[key] !== value)) fail('existing run binding does not match this request');
    return { ...expected, binding, saved };
  }
  for (const file of [evidence, objective, taskInput, output]) if (existsSync(file)) fail(`run already contains ${basename(file)}; refusing to overwrite`);
  const data = { schemaVersion: 1, project: projectName, kind: sourceUrl ? 'url-reference' : 'canonical-run', ...(sourceUrl ? { sourceUrl } : { sourceRunPath: input }) };
  writePrivate(evidence, `${JSON.stringify(data, null, 2)}\n`);
  const creativeOnly = publicationReview === 'separate';
  const vlogPublisher = projectName === 'vlog' && publicationReview === 'publisher-explicit-authorization';
  const publishingPolicy = vlogPublisher
    ? 'Default: no human interactive review, no specialist Final Review or separate Final QA Task. Editor must run Markcut verify and noninteractive source/asset checks (no real viewer required); Producer verifies and renders, with human Preview only on explicit request. Publisher uses WeChat Channels/XHS only with explicit per-video, per-platform and signed-in account authorization; otherwise SKIPPED, and Publisher itself has no review.'
    : null;
  const objectiveText = `Run the ${projectName} project workflow for the selected private canonical run.\n\nRead the run input at ${taskInput} and its source evidence at ${evidence}. ${publishingPolicy || (creativeOnly ? 'Perform Stage contract validation/self-heal; a separate workflow owns all publication/license/use audits. Do not publish.' : 'Apply project source-use, review and publication gates. Do not infer permission or publish.')}\n`;
  const taskText = `Process this selected Neo Project run.\n\n- Project: ${projectName}\n- Canonical run: ${runDir}\n- Private input evidence: ${evidence}\n\nUse the project contract and existing Agent Graph. Preserve existing run files. ${publishingPolicy || (creativeOnly ? 'Do not perform licensing or rights checks in creative Stages; publication review is separate.' : 'Source references do not establish rights or publication permission.')}\n`;
  const instruction = noReview ? '\nPRIVATE RENDER TEST ONLY: honor review-mode.json. SKIP human Preview and specialist review entirely, never call review/notify, render a real MP4, check playback, mark review UNREVIEWED/NOT_RUN, force Publisher SKIPPED, prohibit publication.\n' : '';
  writePrivate(objective, objectiveText + instruction);
  writePrivate(taskInput, taskText + instruction);
  return { evidence, objective, taskInput, output, binding, saved: null };
}

function relayCommand(options) {
  const localCli = options.relayCli ?? process.env.NEO_RELAY_CLI;
  if (localCli) {
    if (!isAbsolute(localCli) || !statSync(localCli).isFile()) fail('NEO_RELAY_CLI must refer to an existing absolute Relay CLI file');
    return { executable: process.execPath, prefix: [realpathSync(localCli)] };
  }
  const executable = options.relayExecutable ?? process.env.NEO_RELAY_EXECUTABLE ?? 'npx';
  return { executable, prefix: executable === 'npx' ? ['-y', '--package', 'agents-relay@latest', 'agents-relay'] : [] };
}

/** Foreground child: forward every event as it arrives and retain an append-only,
 * private per-Run transcript so another observer can tail the same execution. */
export async function executeBoundRun(options, files, args) {
  if (options.runRelayJob) {
    const result = await options.runRelayJob(args);
    if (!Number.isInteger(result) || result < 0 || result > 255) fail('Relay run returned invalid exit status');
    return result;
  }
  const { executable, prefix } = relayCommand(options);
  const path = join(dirname(files.binding), 'neo-project-run.log');
  if (existsSync(path)) {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077)) fail('existing run log is not a private regular file');
  }
  const fd = openSync(path, 'a', 0o600);
  chmodSync(path, 0o600);
  const output = options.emit ?? (value => process.stdout.write(value));
  const errors = options.error ?? (value => process.stderr.write(value));
  let child;
  try {
    child = (options.spawnImpl ?? spawn)(executable, [...prefix, ...args], {
      cwd: dirname(files.binding), stdio: ['inherit', 'pipe', 'pipe'], env: process.env,
    });
  } catch (error) { closeSync(fd); throw error; }
  const forward = (data, sink) => {
    const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
    writeSync(fd, bytes);
    sink(bytes.toString('utf8'));
  };
  child.stdout?.on('data', chunk => forward(chunk, output));
  child.stderr?.on('data', chunk => forward(chunk, errors));
  const onSignal = signal => { if (child.pid && child.exitCode === null && !child.killed) child.kill(signal); };
  const interrupt = () => onSignal('SIGINT');
  const terminate = () => onSignal('SIGTERM');
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', terminate);
  try {
    return await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve(signal ? 5 : code ?? 1));
    });
  } finally {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', terminate);
    closeSync(fd);
  }
}

function relayInvocation(options, args) {
  if (options.runRelay) return options.runRelay(args);
  const { executable, prefix } = relayCommand(options);
  const result = (options.spawnSyncImpl ?? spawnSync)(executable, [...prefix, ...args], { encoding: 'utf8', timeout: 120000, maxBuffer: 4 *  1024 * 1024 });
  if (result.error || result.status !== 0) fail(`Agents Relay command failed (${result.status ?? 'spawn error'}); run artifacts and recovery binding are preserved`);
  try { return JSON.parse(result.stdout); } catch { fail('Agents Relay returned invalid JSON; run artifacts and recovery binding are preserved'); }
}

function responseId(value, label) {
  // Relay job create returns {repository, pr, job: '<ID>', state}; show returns a Job object.
  const id = value?.id ?? (typeof value?.job === 'string' || typeof value?.job === 'number' ? value.job : value?.job?.id) ?? value?.task?.id;
  if (!(typeof id === 'string' || typeof id === 'number') || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(String(id))) fail(`Agents Relay ${label} response did not include a valid id`);
  return String(id);
}

function parseTaskRows(value) { return Array.isArray(value) ? value : Array.isArray(value?.tasks) ? value.tasks : []; }

function verifyBoundTask(task, files, graphPath) {
  if (task.input !== readFileSync(files.taskInput, 'utf8') || task.agentGraph !== readFileSync(graphPath, 'utf8') ||
      task.output?.kind !== 'file' || task.output.path !== files.output)
    fail('existing Relay Task does not match this canonical Run input, output, and Agent Graph');
}

export function runProject(args, options = {}) {
  const parsed = parseOptions(args);
  if (parsed.help) { (options.emit ?? (text => process.stdout.write(text)))(projectRunHelp); return 0; }
  const workspace = options.workspace ?? loadWorkspaceConfig();
  const selected = safeProject(workspace.neoRoot, parsed.project);
  const isUrl = parsed.url !== undefined;
  let url, runDir;
  if (isUrl) url = validateUrl(parsed.url, selected.declaration);
  else {
    runDir = validateRunPath(parsed.path, selected);
    if (selected.declaration.input.type === 'url' && !existsSync(join(runDir, bindingName)))
      fail('URL project --path accepts only an existing bound Run for recovery');
  }
  // Project-owned template asset preflight runs before Job creation; it does not
  // inspect source hashes, licenses or audio generated by later DAG stages.
  if (selected.declaration.preflight?.script) {
    const relativeScript = selected.declaration.preflight.script;
    if (typeof relativeScript !== 'string' || !/^scripts\/[a-zA-Z0-9._-]+\.mjs$/.test(relativeScript)) fail('invalid project preflight script');
    const script = realpathSync(join(selected.project, relativeScript));
    if (!isWithin(selected.project, script) || !statSync(script).isFile()) fail('invalid project preflight script path');
    const check = (options.spawnSyncImpl ?? spawnSync)(process.execPath, [script], { cwd: selected.project, encoding: 'utf8', timeout: 30000, maxBuffer: 1024*1024 });
    if (check.status !== 0) fail(`project template asset preflight failed: ${(check.stderr || check.stdout || check.error?.message || 'unknown').slice(0, 800)}`);
  }
  if (parsed.dryRun) {
    const date = (options.now ?? new Date()).toISOString().slice(0, 10);
    const preview = runDir ?? join(selected.project, 'runs', `${date}-source-<unique>`);
    (options.emit ?? (text => process.stdout.write(text)))(`${JSON.stringify({ project: parsed.project, runPath: preview, inputType: isUrl ? 'url' : 'path', dryRun: true })}\n`);
    return 0;
  }
  if (isUrl) {
    const runs = join(selected.project, 'runs');
    mkdirSync(runs, { recursive: true, mode: 0o700 });
    const runsReal = realpathSync(runs);
    if (!isWithin(selected.project, runsReal)) fail('project runs directory resolves outside the project');
    const slug = `${(options.now ?? new Date()).toISOString().slice(0, 10)}-source-${randomUUID().slice(0, 8)}`;
    runDir = join(runsReal, slug);
    mkdirSync(runDir, { mode: 0o700 });
    chmodSync(runDir, 0o700);
    runDir = realpathSync(runDir);
  }
  const files = initializeRun(runDir, parsed.project, isUrl ? undefined : runDir, isUrl ? parsed.url : undefined, selected.declaration.publicationReview, parsed.noReview === true);
  const repo = options.repository ?? process.env.NEO_RELAY_REPOSITORY ?? 'lalalic/neo';
  const projectPath = relative(selected.root, selected.project).split(sep).join('/');
  const invoke = args => relayInvocation(options, (options.localShortcut ?? Boolean(options.relayCli ?? process.env.NEO_RELAY_CLI)) ? [...args, '--shortcut-local'] : args);
  const runBound = async (jobId, previouslyCompleted = false) => {
    if (previouslyCompleted) {
      (options.emit ?? (value => process.stdout.write(value)))(`${JSON.stringify({ project: parsed.project, runPath: runDir, jobId, taskId: TASK_ID, status: 'COMPLETED', reused: true })}\n`);
      return 0;
    }
    const exitCode = await executeBoundRun(options, files, [
      'job', 'run', '--mode', 'shortcut', '--repo', repo,
      '--id', jobId, '--task-id', TASK_ID,
      '--project-path', selected.root, '--neo-root', selected.root,
      '--workspace-root', workspace.workspaceRoot,
    ]);
    if (exitCode !== 0) return exitCode;
    // Process exit alone does not establish success. Recheck SQLite-backed
    // Relay state after the child has exited, not its terminal text output.
    const updated = invoke(['job', 'show', '--repo', repo, '--id', jobId]);
    const tasks = parseTaskRows(invoke(['task', 'list', '--repo', repo, '--id', jobId]));
    const actual = tasks.find(row => String(row.id ?? row.taskId) === TASK_ID);
    if (updated.state !== 'COMPLETED' || actual?.state !== 'SUCCEEDED') {
      (options.error ?? (value => process.stderr.write(value)))('Relay exited zero without proven durable Job/Task completion\n');
      return 2;
    }
    return 0;
  };
  let jobId;
  if (files.saved?.jobId) {
    if (files.saved.repository !== repo) fail('existing Run binding is associated with a different Relay repository');
    const job = invoke(['job', 'show', '--repo', repo, '--id', String(files.saved.jobId)]);
    jobId = responseId(job, 'verified Job');
    if (jobId !== String(files.saved.jobId) || job.repository !== repo || job.projectPath !== projectPath ||
        job.executionMode !== 'shortcut' || job.contentOnly !== true)
      fail('existing Relay Job does not match this content-only project Run binding');
    const tasks = parseTaskRows(invoke(['task', 'list', '--repo', repo, '--id', jobId]));
    const existing = tasks.find(task => String(task.id ?? task.taskId) === TASK_ID);
    if (existing) {
      verifyBoundTask(existing, files, selected.graph);
      (options.emit ?? (text => process.stdout.write(text)))(`${JSON.stringify({ project: parsed.project, runPath: runDir, jobId, taskId: TASK_ID, verified: true })}\n`);
      return runBound(jobId, existing.state === 'SUCCEEDED' && job.state === 'COMPLETED');
    }
  } else {
    const created = invoke(['job', 'create', '--repo', repo, '--project-path', projectPath, '--objective-file', files.objective, '--shortcut-execution']);
    jobId = responseId(created, 'Job create');
    const binding = { schemaVersion: 1, project: parsed.project, runPath: runDir, jobId, taskId: TASK_ID, repository: repo, evidence: files.evidence, objective: files.objective, taskInput: files.taskInput, output: files.output };
    writePrivate(files.binding, `${JSON.stringify(binding, null, 2)}\n`);
  }
  const task = invoke(['task', 'create', '--repo', repo, '--id', jobId, '--task-id', TASK_ID, '--input-file', files.taskInput, '--output', 'file', '--output-path', files.output, '--agent-graph-file', selected.graph]);
  const taskId = responseId(task, 'Task create');
  if (taskId !== TASK_ID) fail('Agents Relay created an unexpected Task id; run binding is preserved');
  (options.emit ?? (text => process.stdout.write(text)))(`${JSON.stringify({ project: parsed.project, runPath: runDir, jobId, taskId })}\n`);
  return runBound(jobId);
}

export const projectRunHelp = `Usage: neo project run (--url HTTPS_URL | --path ABSOLUTE_RUN_DIR) --project NAME [--dry-run] [--no-review]\n\nOptions accept --name value or --name=value in any order.\n--url       HTTPS source reference for a project that declares URL input\n--path      Existing canonical dated run directory (URL projects may use it to resume a bound Run)\n--project   Project directory beneath the configured Neo workspace\n--dry-run   Validate and preview without writing files or invoking Agents Relay
--no-review Legacy explicit private-render test policy for Vlog; normal Vlog already skips interactive review by default. Does NOT authorize publication\n`;
