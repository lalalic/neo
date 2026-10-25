import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';

const execFileAsync = promisify(execFile);
export const SUPPORTED_SCHEMA_VERSION = 2;
export const NEOX_ICLOUD_INBOX_RELATIVE = 'Library/Mobile Documents/iCloud~com~neox~app/Documents/Vlog Inbox';
export const VLOG_EPISODE_AGENT_GRAPH = [
  'flowchart LR',
  '  editor[agent:vlog-editor] --> producer[agent:vlog-producer]',
].join('\n');

const isSafeId = (value) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
const intakeError = (code, message) => Object.assign(new Error(message), { code });
const inside = (root, candidate) => {
  const relative = path.relative(root, candidate);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

async function locallyAvailable(filePath, stat = fs.stat) {
  const info = await stat(filePath);
  if (!info.isFile() || info.size === 0) return false;
  const handle = await fs.open(filePath, 'r');
  try { await handle.read(Buffer.alloc(1), 0, 1, 0); return true; }
  finally { await handle.close(); }
}

function mediaEntries(manifest) {
  if (!Array.isArray(manifest.media) || !manifest.media.length) throw new Error('manifest.media must be a non-empty array');
  return manifest.media.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`manifest.media[${index}] must be an object`);
    if (!isSafeId(entry.media_id)) throw new Error(`manifest.media[${index}].media_id is missing or unsafe`);
    if (typeof entry.path !== 'string' || !entry.path || entry.path.includes('\0')) throw new Error(`manifest.media[${index}].path is missing`);
    return entry;
  });
}

export async function readAndValidateManifest(submissionDir, options = {}) {
  const manifestPath = path.join(submissionDir, 'manifest.json');
  const root = await fs.realpath(submissionDir);
  const manifestInfo = await fs.lstat(manifestPath).catch(() => null);
  if (!manifestInfo?.isFile() || manifestInfo.isSymbolicLink()) throw new Error('manifest.json must be a regular local file');
  let manifest;
  try { manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')); }
  catch (error) { throw new Error(`invalid manifest.json: ${error.message}`); }
  if (manifest.schema_version !== SUPPORTED_SCHEMA_VERSION) throw new Error(`unsupported manifest schema version: ${manifest.schema_version}`);
  if (!isSafeId(manifest.submission_id)) throw new Error('manifest.submission_id is missing or unsafe');
  if (!Number.isFinite(new Date(manifest.submitted_at).getTime())) throw new Error('manifest.submitted_at must be a valid timestamp');
  if (!isSafeId(manifest.master_id)) throw new Error('manifest.master_id is missing or unsafe');
  if (!['manual_icloud', 'auto_lan'].includes(manifest.source_mode)) throw new Error('manifest.source_mode is unsupported');
  if (!manifest.authenticated_submission || !isSafeId(manifest.authenticated_submission.subject_id) || !manifest.authenticated_submission.issuer || !manifest.authenticated_submission.assertion_id) {
    throw intakeError('IDENTITY_NEEDED', 'manifest.authenticated_submission must identify the authenticated Neo principal and assertion');
  }
  const entries = mediaEntries(manifest);
  const approved = manifest.source_approval;
  if (approved?.status !== 'approved' || !approved.authorization_id || !approved.approved_at) throw intakeError('APPROVAL_NEEDED', 'source/use approval is missing');
  const approvedIds = new Set(approved.media_ids ?? []);
  if (entries.some((entry) => !approvedIds.has(entry.media_id))) throw intakeError('APPROVAL_NEEDED', 'source/use approval does not cover every submitted media item');
  const available = options.isLocallyAvailable ?? locallyAvailable;
  const resolvedMedia = [];
  for (const entry of entries) {
    if (path.isAbsolute(entry.path)) throw new Error(`media path must be relative: ${entry.path}`);
    const candidate = path.resolve(root, entry.path);
    if (!inside(root, candidate)) throw new Error(`media path escapes submission: ${entry.path}`);
    const linkInfo = await fs.lstat(candidate).catch(() => null);
    if (!linkInfo || linkInfo.isSymbolicLink() || !linkInfo.isFile()) throw new Error(`media is missing or not a regular local file: ${entry.path}`);
    if (!(await available(candidate))) throw new Error(`media is not fully available locally: ${entry.path}`);
    if (Number.isSafeInteger(entry.size_bytes) && linkInfo.size !== entry.size_bytes) throw new Error(`media size is incomplete: ${entry.path}`);
    if (entry.sha256) {
      const actual = createHash('sha256').update(await fs.readFile(candidate)).digest('hex');
      if (actual !== entry.sha256) throw new Error(`media checksum mismatch: ${entry.path}`);
    }
    resolvedMedia.push({ ...entry, absolutePath: candidate });
  }
  return { manifest, manifestPath, submissionId: manifest.submission_id, media: resolvedMedia };
}

async function directoryEntries(directory) {
  try { return await fs.readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

async function findInboxSubmissions(inboxDir) {
  return (await directoryEntries(inboxDir)).filter((entry) => entry.isDirectory()).map((entry) => path.join(inboxDir, entry.name));
}

async function findMovedInputs(runsDir) {
  const found = [];
  for (const entry of await directoryEntries(runsDir)) {
    if (!entry.isDirectory() || !/^\d{4}-\d{2}-\d{2}-.+$/.test(entry.name)) continue;
    const input = path.join(runsDir, entry.name, 'input');
    try { if ((await fs.stat(path.join(input, 'manifest.json'))).isFile()) found.push(input); }
    catch { /* not yet moved or not an accepted input */ }
  }
  return found;
}

function runIdentity(manifest, fallback = new Date()) {
  const instant = new Date(manifest.submitted_at);
  const safeInstant = Number.isFinite(instant.getTime()) ? instant : fallback;
  const date = safeInstant.toISOString().slice(0, 10);
  return `${date}-${manifest.submission_id.toLowerCase()}`;
}

function intakeRecord({ checked, readiness, completeness, observedAt, reason, taskId, lifecycle }) {
  return {
    schema_version: 1,
    submission_id: checked.manifest.submission_id,
    master_id: checked.manifest.master_id,
    source_mode: checked.manifest.source_mode,
    authenticated_submission: checked.manifest.authenticated_submission,
    source_approval: checked.manifest.source_approval,
    media: { readiness, completeness, observed_at: observedAt, ...(reason ? { reason } : {}) },
    episode: { task_id: taskId ?? null, lifecycle: lifecycle ?? (taskId ? 'accepted' : 'not-created') },
  };
}

async function writeIntake(runDir, record) {
  await fs.mkdir(runDir, { recursive: true });
  const target = path.join(runDir, 'intake.json');
  const temporary = `${target}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`);
  await fs.rename(temporary, target);
}

function taskInput({ manifest, submissionId, runDir, manifestPath }) {
  return [
    `Create the Vlog episode for submission ${submissionId}.`, '',
    'Canonical intake:',
    `- submission_id: ${submissionId}`,
    `- master_id: ${manifest.master_id}`,
    `- source_mode: ${manifest.source_mode}`,
    `- authenticated_submission: ${JSON.stringify(manifest.authenticated_submission)}`,
    `- source_approval: ${JSON.stringify(manifest.source_approval)}`,
    `- run_directory: ${runDir}`,
    `- source_manifest: ${manifestPath}`,
    '',
    'Follow vlog/AGENTS.md. This is exactly one top-level Episode Task; keep normal phases in its agentGraph.',
  ].join('\n');
}

export function createCliRelayClient(config = {}) {
  const env = config.env ?? process.env;
  const execCommand = config.execFileAsync ?? execFileAsync;
  const required = (name) => { if (!env[name]) throw new Error(`missing required watcher configuration: ${name}`); return env[name]; };
  const repo = required('VLOG_RELAY_REPO');
  const pr = required('VLOG_RELAY_PR');
  const base = ['--yes', '--package', 'agents-relay@latest', 'agents-relay'];
  const run = async (args) => {
    const { stdout } = await execCommand('npx', [...base, ...args], { maxBuffer: 10 * 1024 * 1024 });
    return JSON.parse(stdout);
  };
  let allocatedJob;
  const job = async () => allocatedJob ??= env.VLOG_RELAY_JOB_ID
    ? { job: { id: env.VLOG_RELAY_JOB_ID } }
    : run(['job', 'adopt', '--repo', repo, '--pr', pr]);
  return {
    listTasks: async () => { const j = await job(); return run(['task', 'list', '--repo', repo, '--pr', pr, '--id', String(j.job.id)]); },
    createTask: async ({ taskId, idempotencyKey, input, outputPath, agentGraph }) => {
      const j = await job();
      const args = [
        'task', 'create', '--repo', repo, '--pr', pr, '--id', String(j.job.id),
        '--task-id', taskId, '--idempotency-key', idempotencyKey,
        '--output', 'file', '--output-path', outputPath,
        '--input', input, '--agent-graph', agentGraph,
      ];
      if (env.VLOG_RELAY_AGENT) args.push('--agent', env.VLOG_RELAY_AGENT);
      return run(args);
    },
  };
}

async function taskExists(relay, taskId, submissionId) {
  const tasks = await relay.listTasks();
  return tasks.find((task) => task.id === taskId || task.idempotencyKey === `vlog-episode:${submissionId}` || (typeof task.input === 'string' && task.input.includes(`submission_id: ${submissionId}`)));
}

export async function processSubmission(sourceDir, { runsDir, relay, now = new Date(), isLocallyAvailable, lateAfterMs = 24 * 60 * 60 * 1000 } = {}) {
  const alreadyMoved = path.basename(sourceDir) === 'input';
  const manifestPath = path.join(sourceDir, 'manifest.json');
  let manifest;
  try { manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')); }
  catch (error) { return { status: 'waiting-manifest', path: sourceDir, reason: error.message }; }
  const submittedAt = new Date(manifest.submitted_at);
  const late = Number.isFinite(submittedAt.getTime()) && now.getTime() - submittedAt.getTime() > lateAfterMs;
  let checked;
  try { checked = await readAndValidateManifest(sourceDir, { isLocallyAvailable }); }
  catch (error) {
    let id = isSafeId(manifest.submission_id) ? manifest.submission_id : path.basename(sourceDir);
    let runDir;
    runDir = path.join(runsDir, runIdentity(manifest, now));
    if (isSafeId(manifest.submission_id)) await writeIntake(runDir, intakeRecord({
      checked: { manifest }, readiness: error.code === 'APPROVAL_NEEDED' || error.code === 'IDENTITY_NEEDED' ? 'unknown' : 'incomplete', completeness: error.code === 'APPROVAL_NEEDED' || error.code === 'IDENTITY_NEEDED' ? 'unknown' : 'incomplete', observedAt: now.toISOString(),
      reason: error.message, lifecycle: 'not-created',
    }));
    const status = error.code === 'APPROVAL_NEEDED' ? 'permission-needed' : error.code === 'IDENTITY_NEEDED' ? 'identity-needed' : late ? 'late-incomplete' : 'incomplete';
    return { status, path: sourceDir, reason: error.message, runDir };
  }
  const runDir = path.join(runsDir, runIdentity(checked.manifest));
  const inputDir = path.join(runDir, 'input');
  const taskId = `vlog-episode-${checked.submissionId}`;
  const existing = await taskExists(relay, taskId, checked.submissionId);
  if (!existing) {
    await fs.mkdir(runDir, { recursive: true });
    try { if (!alreadyMoved) await fs.rename(sourceDir, inputDir); }
    catch (error) {
      if (error.code === 'EXDEV') throw new Error('iCloud inbox and VLOG_RUNS_DIR must support a same-volume atomic move');
      throw error;
    }
    const moved = await readAndValidateManifest(inputDir, { isLocallyAvailable });
    await fs.copyFile(path.join(inputDir, 'manifest.json'), path.join(runDir, 'source-manifest.json'));
    await relay.createTask({
      taskId,
      idempotencyKey: `vlog-episode:${checked.submissionId}`,
      input: taskInput({ manifest: moved.manifest, submissionId: checked.submissionId, runDir, manifestPath: path.join(runDir, 'source-manifest.json') }),
      outputPath: path.join('runs', path.basename(runDir), 'story.md'),
      agentGraph: VLOG_EPISODE_AGENT_GRAPH,
    });
    await writeIntake(runDir, intakeRecord({ checked: moved, readiness: 'ready', completeness: 'complete', observedAt: now.toISOString(), taskId, lifecycle: 'accepted' }));
    return { status: 'task-created', taskId, runDir };
  }
  await writeIntake(runDir, intakeRecord({ checked, readiness: 'ready', completeness: 'complete', observedAt: now.toISOString(), taskId, lifecycle: existing.status ?? 'accepted' }));
  return { status: 'already-tasked', taskId, runDir };
}

export async function scanOnce({ inboxDir, runsDir, relay, now = new Date(), isLocallyAvailable, lateAfterMs } = {}) {
  if (!inboxDir || !runsDir || !relay) throw new Error('inboxDir, runsDir, and relay are required');
  const results = [];
  for (const sourceDir of [...await findMovedInputs(runsDir), ...await findInboxSubmissions(inboxDir)]) {
    try { results.push(await processSubmission(sourceDir, { runsDir, relay, now, isLocallyAvailable, lateAfterMs })); }
    catch (error) { results.push({ status: 'rejected', path: sourceDir, reason: error.message }); }
  }
  return results;
}
