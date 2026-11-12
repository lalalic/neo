import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmodSync, closeSync, existsSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, statSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { loadWorkspaceConfig } from './workspace-config.mjs';
import { loadRunGitConfig, ensureRunGit } from './neo-run-git.mjs';

const TASK_ID = 'coordinator';
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
    const match = /^(--(?:url|path|project|title))(?:=(.*))?$/.exec(raw);
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
  if (result.title !== undefined && (!result.title.trim() || result.title.trim().length > 120 || /[\x00-\x1f\x7f]/.test(result.title))) fail('--title requires 1–120 printable characters');
  if (result.title !== undefined) result.title = result.title.trim();
  return result;
}

export function safeProject(neoRoot, name) {
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

/** A readable, non-sensitive title. In URL mode use only the generated Run
 * folder name, never the original URL (which may contain private tokens). */
export function projectRunTitle(projectName, runDir) {
  const readableProject = projectName.split(/[-_]+/).map(word => word === 'vlog' ? 'Vlog' : word[0].toUpperCase() + word.slice(1)).join(' ');
  const readableRun = basename(runDir).replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return `${readableProject} · ${readableRun}`.slice(0, 120);
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

export function validateRunPath(input, selected) {
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
  const reviewStagesFile = projectName === 'vlog' ? join(runDir, 'review-stages.json') : null;
  let requestedReviews = [];
  if (reviewStagesFile && existsSync(reviewStagesFile)) {
    let stages;
    try { stages = JSON.parse(readFileSync(reviewStagesFile, 'utf8')); }
    catch { fail('invalid Vlog review-stages.json'); }
    if (!stages || typeof stages !== 'object' || Array.isArray(stages) ||
        Object.entries(stages).some(([name, enabled]) =>
          !['visioner', 'director', 'producer'].includes(name) || typeof enabled !== 'boolean'))
      fail('Vlog review-stages.json accepts only boolean visioner/director/producer');
    requestedReviews = ['visioner', 'director', 'producer'].filter(stage => stages[stage] === true);
    if (noReview && requestedReviews.length) fail('--no-review conflicts with enabled Vlog interactive review stages');
  }
  const requestedReviewPolicy = requestedReviews.length
    ? `EXPLICIT INTERACTIVE REVIEWS: review-stages.json requires human Preview and authenticated approval for these exact Task stages: ${requestedReviews.join(', ')}. Each enabled Agent must call Relay review interactive with its own Task execution identity, enter AWAITING_DECISION, and only complete after a matching approved decision; Request Changes must revise and re-preview. Do NOT claim stage completion based on Preview compilation or notification delivery. No extra Review Task or Final Review.`
    : '';
  const publishingPolicy = vlogPublisher
    ? `${requestedReviews.length ? 'Requested stages must perform the interactive review in review-stages.json.' : 'Default: no human interactive review.'} No specialist Final Review or separate Final QA Task. Editor must run Markcut verify and noninteractive source/asset checks (no real viewer required); Producer verifies and renders, with human Preview only on explicit request. Publisher uses WeChat Channels/XHS only with explicit per-video, per-platform and signed-in account authorization; otherwise SKIPPED, and Publisher itself has no review.`
    : null;
  const objectiveText = `Run the ${projectName} project workflow for the selected private canonical run.\n\nRead the run input at ${taskInput} and its source evidence at ${evidence}. ${publishingPolicy || (creativeOnly ? 'Perform Stage contract validation/self-heal; a separate workflow owns all publication/license/use audits. Do not publish.' : 'Apply project source-use, review and publication gates. Do not infer permission or publish.')}\n`;
  const taskText = `Process this selected Neo Project run.\n\n- Project: ${projectName}\n- Canonical run: ${runDir}\n- Private input evidence: ${evidence}\n\nUse the project contract and existing Agent Graph. Preserve existing run files. ${publishingPolicy || (creativeOnly ? 'Do not perform licensing or rights checks in creative Stages; publication review is separate.' : 'Source references do not establish rights or publication permission.')}\n`;
  const instruction = noReview ? '\nPRIVATE RENDER TEST ONLY: honor review-mode.json. SKIP human Preview and specialist review entirely, never call review/notify, render a real MP4, check playback, mark review UNREVIEWED/NOT_RUN, force Publisher SKIPPED, prohibit publication.\n' :
    requestedReviewPolicy ? `\n${requestedReviewPolicy}\n` : '';
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


function relayInvocation(options, args) {
  if (options.runRelay) return options.runRelay(args);
  const { executable, prefix } = relayCommand(options);
  const result = (options.spawnSyncImpl ?? spawnSync)(executable, [...prefix, ...args], { encoding: 'utf8', timeout: 120000, maxBuffer: 4 *  1024 * 1024, env: { ...process.env, ...(options.sharedRoot ? { AGENTS_RELAY_SHARED_ROOT: options.sharedRoot } : {}) } });
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
  const projectRoot = workspace.neoRoot;
  const selected = safeProject(projectRoot, parsed.project);
  const git = (...args) => {
    const result = spawnSync('git', ['-C', selected.project, ...args], { encoding: 'utf8', timeout: 10000 });
    return result.status === 0 ? result.stdout.trim() : null;
  };
  const gitRoot = git('rev-parse', '--show-toplevel');
  const independent = gitRoot === selected.project;
  if (!independent) fail('NEO_ROOT projects must be independent Git repositories');
  const repoId = options.repository ?? process.env.NEO_RELAY_REPOSITORY ?? parsed.project;
  if (repoId !== parsed.project) fail('Relay repository identity must match local Git project name');
  // A GitHub origin is not approval to create a PR or push. Neo Projects stay local.
  const relayFlags = ['--no-github'];
  const repoProjectPath = '.';
  const repoCheckout = selected.project;
  const relayOptions = { ...options, sharedRoot: workspace.harnessRoot };
  const runGit = loadRunGitConfig(selected.project, selected.declaration);
  const isUrl = parsed.url !== undefined;
  let url, runDir;
  if (isUrl) url = validateUrl(parsed.url, selected.declaration);
  else {
    runDir = validateRunPath(parsed.path, selected);
    if (selected.declaration.input.type === 'url' && !existsSync(join(runDir, bindingName))) {
      // Explicit project opt-in: operate a pre-populated canonical private Run in
      // place. Source files are only evidence; downstream project gates still own
      // media rights, inference permissions, review and publication authorization.
      if (selected.declaration.input.preparedPath !== true ||
          !existsSync(join(runDir, 'campaign.json')) ||
          !existsSync(join(runDir, 'evidence', 'original-source.json')))
        fail('URL project --path accepts only an existing bound Run, unless preparedPath is enabled with canonical source evidence');
    }
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
  ensureRunGit(runDir, runGit);
  const repo = repoId;
  const projectPath = repoProjectPath;
  const invoke = args => relayInvocation(relayOptions,[...args,...relayFlags]);
  const startBound=jobId=>{
    const job=invoke(['job','show','--repo',repo,'--id',jobId]);
    if(job.repository!==repo||job.projectPath!==projectPath)fail('existing Relay Job does not match this project');
    const task= parseTaskRows(invoke(['task','list','--repo',repo,'--id',jobId]))
      .find(row=>String(row.id??row.taskId)===TASK_ID);
    if(!task)fail('Atomic Coordinator Task missing from Relay Job');
    verifyBoundTask(task,files,selected.graph);
    let state=job.state;
    if(state==='DRAFT'){
      const activated=invoke(['job','run','--repo',repo,'--id',jobId,'--task-id',TASK_ID,
        '--project-path',repoCheckout,'--shared-root',workspace.harnessRoot,
        '--workspace-root',workspace.neoRoot]);
      if(activated?.scheduled!==true||activated?.state!=='ACTIVE')fail('Relay Coordinator activation not acknowledged');
      state='ACTIVE';
    }
    if(!['ACTIVE','COMPLETED'].includes(state))fail('Bound Job is not active or completed: '+state);
    (options.emit??(value=>process.stdout.write(value)))(JSON.stringify({project:parsed.project,
      runPath:runDir,jobId,taskId:TASK_ID,status:state,...(state==='COMPLETED'?{reused:true}:{})})+'\n');
    return 0;
  };
  let jobId;
  if(files.saved?.jobId){
    if(files.saved.repository!==repo)fail('existing Run binding belongs to another Relay repository');
    const job=invoke(['job','show','--repo',repo,'--id',String(files.saved.jobId)]);
    jobId=responseId(job,'verified Job');
    if(jobId!==String(files.saved.jobId))fail('existing Relay Job identity changed');
    return startBound(jobId);
  }
  const title=parsed.title??projectRunTitle(parsed.project,runDir);
  const created=invoke(['job','create','--repo',repo,'--project-root',repoCheckout,'--project-path',projectPath,'--title',title,
    '--objective-file',files.objective,'--coordinator-graph-file',selected.graph,
    '--coordinator-input-file',files.taskInput,'--coordinator-output-path',files.output,
    '--coordinator-project-root',repoCheckout,'--coordinator-workspace-root',workspace.neoRoot,
    '--coordinator-shared-root',workspace.harnessRoot,
    ...(parsed.noReview?['--no-review']:[])]);
  jobId=responseId(created,'Job create');
  if(created.taskId!==TASK_ID||created.state!=='DRAFT')fail('Relay did not atomically create a DRAFT Coordinator Job');
  const binding={schemaVersion:1,project:parsed.project,runPath:runDir,jobId,taskId:TASK_ID,
    repository:repo,evidence:files.evidence,objective:files.objective,taskInput:files.taskInput,output:files.output};
  writePrivate(files.binding,JSON.stringify(binding,null,2)+'\n');
  return startBound(jobId);
}

export const projectRunHelp=`Usage: neo project run (--url HTTPS_URL | --path ABSOLUTE_RUN_DIR) --project NAME [--title TEXT] [--dry-run] [--no-review]

Creates one ordinary DRAFT Relay Job and its durable Coordinator DAG Task in
a single SQLite transaction, binds this private Run, then activates the Job
through regular Relay job run. Returns ACTIVE without waiting for final media.
Each Script/Model Agent is a separate durable Task. On terminal completion,
all newly ready DAG successors start immediately when Worker capacity permits.
Reviews, retry, recovery, Final Review and Git Merge use the ordinary Job/Task
lifecycle. Human Preview never auto-commits Git. No Shortcut Runner, separate
DAG scheduler, initial Planner or content-only execution mode is created.

Options accept --name value or --name=value in any order.
--url       HTTPS source reference for a project declaring URL input
--path      Existing canonical dated Run (or a prepared URL-project Run)
--project   Independent project Git repository beneath NEO_ROOT
--title     Human Job title (creation only, 1–120 printable characters)
--dry-run   Validate and preview without writes or Relay calls
--no-review Private Vlog render test only: approved source-use required,
            publication blocked (not a general Final Review bypass)
Vlog review-stages.json may opt in boolean visioner/director/producer stages;
            opted-in stages require Task-bound approval or Request Changes.

Re-running an already-bound Run verifies the stored Job/Graph/Task and returns
its current state; it does not create another Job or restart completed work.
`;
