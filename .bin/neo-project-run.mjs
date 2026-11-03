import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, readFileSync, realpathSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
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

function initializeRun(runDir, projectName, input, sourceUrl) {
  const evidence = join(runDir, 'source-reference.json');
  const objective = join(runDir, 'neo-project-run.objective.md');
  const taskInput = join(runDir, 'neo-project-run.input.md');
  const output = join(runDir, 'neo-project-run.result.json');
  const binding = join(runDir, bindingName);
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
  const objectiveText = `Run the ${projectName} project workflow for the selected private canonical run.\n\nRead the run input at ${taskInput} and its private source evidence at ${evidence}. Treat references as unverified input; apply the project AGENTS.md rights, review, and publication gates. Do not infer permission or publish without explicit owner authorization.\n`;
  const taskText = `Process this selected Neo Project run.\n\n- Project: ${projectName}\n- Canonical run: ${runDir}\n- Private input evidence: ${evidence}\n\nUse the project contract and existing Agent Graph. Preserve existing run files. Source references do not establish rights or publication permission.\n`;
  writePrivate(objective, objectiveText);
  writePrivate(taskInput, taskText);
  return { evidence, objective, taskInput, output, binding, saved: null };
}

function relayInvocation(options, args) {
  if (options.runRelay) return options.runRelay(args);
  const executable = options.relayExecutable ?? process.env.NEO_RELAY_EXECUTABLE ?? 'npx';
  const prefix = executable === 'npx' ? ['-y', '--package', 'agents-relay@latest', 'agents-relay'] : [];
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
  const files = initializeRun(runDir, parsed.project, isUrl ? undefined : runDir, isUrl ? parsed.url : undefined);
  const repo = options.repository ?? process.env.NEO_RELAY_REPOSITORY ?? 'lalalic/neo';
  const projectPath = relative(selected.root, selected.project).split(sep).join('/');
  const invoke = args => relayInvocation(options, args);
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
      return 0;
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
  return 0;
}

export const projectRunHelp = `Usage: neo project run (--url HTTPS_URL | --path ABSOLUTE_RUN_DIR) --project NAME [--dry-run]\n\nOptions accept --name value or --name=value in any order.\n--url       HTTPS source reference for a project that declares URL input\n--path      Existing canonical dated run directory (URL projects may use it to resume a bound Run)\n--project   Project directory beneath the configured Neo workspace\n--dry-run   Validate and preview without writing files or invoking Agents Relay\n`;
