import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
export const SUPPORTED_SCHEMA_VERSION = 1;

const isSafeSubmissionId = (value) =>
  typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function locallyAvailable(filePath, stat = fs.stat) {
  const info = await stat(filePath);
  if (!info.isFile() || info.size === 0) return false;
  const handle = await fs.open(filePath, 'r');
  try {
    await handle.read(Buffer.alloc(1), 0, 1, 0);
    return true;
  } finally {
    await handle.close();
  }
}

function mediaPaths(manifest) {
  if (!Array.isArray(manifest.media) || manifest.media.length === 0) {
    throw new Error('manifest.media must be a non-empty array');
  }
  return manifest.media.map((entry, index) => {
    const value = typeof entry === 'string' ? entry : entry?.path;
    if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) {
      throw new Error(`manifest.media[${index}] must contain a path`);
    }
    return value;
  });
}

export async function readAndValidateManifest(submissionDir, options = {}) {
  const manifestPath = path.join(submissionDir, 'manifest.json');
  const root = await fs.realpath(submissionDir);
  const manifestInfo = await fs.lstat(manifestPath).catch(() => null);
  if (!manifestInfo?.isFile() || manifestInfo.isSymbolicLink()) throw new Error('manifest.json must be a regular local file');
  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  } catch (error) {
    throw new Error(`invalid manifest.json: ${error.message}`);
  }
  const version = manifest.schema_version ?? manifest.version;
  if (version !== SUPPORTED_SCHEMA_VERSION) throw new Error(`unsupported manifest schema version: ${version}`);
  if (!isSafeSubmissionId(manifest.submission_id)) throw new Error('manifest.submission_id is missing or unsafe');

  const paths = mediaPaths(manifest);
  const available = options.isLocallyAvailable ?? locallyAvailable;
  const resolvedMedia = [];
  for (const relative of paths) {
    if (path.isAbsolute(relative)) throw new Error(`media path must be relative: ${relative}`);
    const candidate = path.resolve(root, relative);
    if (!inside(root, candidate)) throw new Error(`media path escapes submission: ${relative}`);
    const linkInfo = await fs.lstat(candidate).catch(() => null);
    if (!linkInfo || linkInfo.isSymbolicLink()) throw new Error(`media is missing or not a regular local file: ${relative}`);
    if (!(await available(candidate))) throw new Error(`media is not fully available locally: ${relative}`);
    resolvedMedia.push({ path: relative, absolutePath: candidate });
  }
  return { manifest, manifestPath, submissionId: manifest.submission_id, media: resolvedMedia };
}

async function directoryEntries(directory) {
  try { return await fs.readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

async function findInboxSubmissions(inboxDir) {
  const entries = await directoryEntries(inboxDir);
  return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(inboxDir, entry.name));
}

async function findMovedSubmissions(runsDir) {
  const result = [];
  for (const day of await directoryEntries(runsDir)) {
    if (!day.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(day.name)) continue;
    for (const hour of await directoryEntries(path.join(runsDir, day.name))) {
      if (!hour.isDirectory() || !/^\d{2}$/.test(hour.name)) continue;
      for (const submission of await directoryEntries(path.join(runsDir, day.name, hour.name))) {
        if (!submission.isDirectory()) continue;
        const input = path.join(runsDir, day.name, hour.name, submission.name, 'input');
        try { if ((await fs.stat(path.join(input, 'manifest.json'))).isFile()) result.push(input); }
        catch { /* incomplete/unowned directories are ignored */ }
      }
    }
  }
  return result;
}

function localDateParts(date) {
  const day = [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part, index) => index === 0 ? String(part) : String(part).padStart(2, '0')).join('-');
  return { day, hour: String(date.getHours()).padStart(2, '0') };
}

function taskInput({ manifest, submissionId, runDir, manifestPath }) {
  return [
    `Create the Vlog episode for submission ${submissionId}.`,
    '',
    'Authoritative input:',
    `- submission_id: ${submissionId}`,
    `- run_directory: ${runDir}`,
    `- manifest_path: ${manifestPath}`,
    `- manifest_metadata: ${JSON.stringify(manifest)}`,
    '',
    'Follow the existing Vlog episode contract in vlog/AGENTS.md. This is one top-level episode Task; keep editorial, production, review, render, QA, and authorized publication within that episode flow.',
  ].join('\n');
}

export function createCliRelayClient(config = {}) {
  const env = config.env ?? process.env;
  const required = (name) => {
    if (!env[name]) throw new Error(`missing required watcher configuration: ${name}`);
    return env[name];
  };
  const repo = required('VLOG_RELAY_REPO');
  const pr = required('VLOG_RELAY_PR');
  const jobId = required('VLOG_RELAY_JOB_ID');
  const adapter = required('VLOG_RELAY_ADAPTER');
  const model = env.VLOG_RELAY_MODEL;
  const provider = env.VLOG_RELAY_PROVIDER;
  if ((adapter === 'codex' || adapter === 'chatgpt') && (!model || !provider)) {
    throw new Error('VLOG_RELAY_PROVIDER and VLOG_RELAY_MODEL are required for model-backed adapters');
  }
  const base = ['--yes', 'agents-relay'];
  const storage = ['--repo', repo, '--pr', pr, '--id', jobId];
  const run = async (args, input) => {
    const { stdout } = await execFileAsync('npx', [...base, ...args], { input, maxBuffer: 10 * 1024 * 1024 });
    return JSON.parse(stdout);
  };
  return {
    listTasks: () => run(['task', 'list', ...storage]),
    createTask: ({ taskId, input }) => {
      const args = ['task', 'create', ...storage, '--task-id', taskId, '--adapter', adapter, '--output', 'task-pr', '--input', input];
      if (provider) args.push('--provider', provider);
      if (model) args.push('--model', model);
      if (env.VLOG_RELAY_AGENT) args.push('--agent', env.VLOG_RELAY_AGENT);
      return run(args);
    },
  };
}

async function taskExists(relay, taskId, manifestPath) {
  const tasks = await relay.listTasks();
  return tasks.some((task) => task.id === taskId || (typeof task.input === 'string' && task.input.includes(manifestPath)));
}

export async function processMovedInput(inputDir, { runsDir, relay, now = new Date(), isLocallyAvailable } = {}) {
  const checked = await readAndValidateManifest(inputDir, { isLocallyAvailable });
  const runDir = path.dirname(inputDir);
  const taskId = `vlog-episode-${checked.submissionId}`;
  if (await taskExists(relay, taskId, checked.manifestPath)) return { status: 'already-tasked', taskId, runDir };
  await relay.createTask({ taskId, input: taskInput({ ...checked, runDir }) });
  return { status: 'task-created', taskId, runDir };
}

export async function processSubmission(sourceDir, { runsDir, relay, now = new Date(), isLocallyAvailable } = {}) {
  const checked = await readAndValidateManifest(sourceDir, { isLocallyAvailable });
  const { day, hour } = localDateParts(now);
  const runDir = path.join(runsDir, day, hour, checked.submissionId);
  const inputDir = path.join(runDir, 'input');
  await fs.mkdir(runDir, { recursive: true });
  let destinationExists = false;
  try {
    await fs.stat(inputDir);
    destinationExists = true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (destinationExists) {
    const sourceExists = await fs.stat(sourceDir).then(() => true).catch((error) => {
      if (error.code === 'ENOENT') return false;
      throw error;
    });
    if (sourceExists) throw new Error(`destination already exists for submission ${checked.submissionId}`);
  } else await fs.rename(sourceDir, inputDir);
  return processMovedInput(inputDir, { runsDir, relay, now, isLocallyAvailable });
}

export async function scanOnce({ inboxDir, runsDir, relay, now = new Date(), isLocallyAvailable } = {}) {
  if (!inboxDir || !runsDir || !relay) throw new Error('inboxDir, runsDir, and relay are required');
  const moved = await findMovedSubmissions(runsDir);
  const inbox = await findInboxSubmissions(inboxDir);
  const results = [];
  for (const inputDir of moved) {
    try { results.push(await processMovedInput(inputDir, { runsDir, relay, now, isLocallyAvailable })); }
    catch (error) { results.push({ status: 'rejected', path: inputDir, reason: error.message }); }
  }
  for (const submissionDir of inbox) {
    try { results.push(await processSubmission(submissionDir, { runsDir, relay, now, isLocallyAvailable })); }
    catch (error) { results.push({ status: 'rejected', path: submissionDir, reason: error.message }); }
  }
  return results;
}
