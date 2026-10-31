import { promises as fs } from 'node:fs';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
export const SUPPORTED_SCHEMA_VERSION = 1;
export const NEOX_ICLOUD_INBOX_RELATIVE = 'Library/Mobile Documents/iCloud~com~neox~app/Documents/Vlog Inbox';

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

async function fileSha256(filePath) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) digest.update(chunk);
  return digest.digest('hex');
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
    const entry = manifest.media[resolvedMedia.length];
    const expected = typeof entry === 'object' && entry !== null ? entry.sha256 : undefined;
    if (expected !== undefined) {
      if (typeof expected !== 'string' || !/^[0-9a-f]{64}$/i.test(expected)) throw new Error(`invalid media SHA-256 in manifest: ${relative}`);
      if ((await fileSha256(candidate)) !== expected.toLowerCase()) throw new Error(`media SHA-256 mismatch: ${relative}`);
    }
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
        try {
          const manifest = await fs.stat(path.join(input, 'manifest.json'));
          const owner = await Promise.any([
            fs.stat(path.join(path.dirname(input), 'manual-intake.json')),
            fs.stat(path.join(path.dirname(input), 'episode-job.json')),
          ]).catch(() => null);
          if (manifest.isFile() && owner?.isFile()) result.push(input);
        } catch { /* incomplete/unowned directories are ignored */ }
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
    'Read the manifest and existing Markcut Vision metadata from the run directory; reuse stored perception before requesting any missing analysis.',
    '',
    'Read the canonical Vlog graph.mmd. The project-local Relay Planner must create all normal Stage Tasks in the first Plan, with dependencies controlling execution order; do not create a root Episode/Visioner wrapper Task or use a single multi-role agentGraph. Later Plan rounds may add revision or recovery Tasks. Archive by default; publication needs explicit authorization.',
  ].join('\n');
}

export function episodeJobCreateArgs({ repo, projectPath, submissionId, objectiveFile }) {
  return [
    'job', 'create', '--repo', repo, '--project-path', projectPath,
    '--title', `Vlog Episode ${submissionId}`,
    '--objective-file', objectiveFile,
  ];
}

export function episodeJobShowArgs({ repo, jobId }) {
  return ['job', 'show', '--repo', repo, '--id', String(jobId)];
}

export function createCliRelayClient(config = {}) {
  const env = config.env ?? process.env;
  const repo = env.VLOG_RELAY_REPO ?? 'lalalic/neo';
  const projectPath = env.VLOG_RELAY_PROJECT_PATH ?? 'vlog';
  const base = ['--yes', '--package', 'agents-relay@latest', 'agents-relay'];
  const executor = config.exec ?? execFileAsync;
  const run = async (args, input) => {
    const { stdout } = await executor('npx', [...base, ...args], { input, maxBuffer: 10 * 1024 * 1024 });
    return JSON.parse(stdout);
  };
  return {
    createJob: async ({ submissionId, objectiveFile }) => run(
      episodeJobCreateArgs({ repo, projectPath, submissionId, objectiveFile })
    ),
    getJob: (jobId) => run(episodeJobShowArgs({ repo, jobId })),
    planJob: (jobId) => run(['plan', '--repo', repo, '--id', String(jobId)]),
  };
}

export async function processMovedInput(inputDir, { runsDir, relay, now = new Date(), isLocallyAvailable } = {}) {
  const checked = await readAndValidateManifest(inputDir, { isLocallyAvailable });
  const runDir = path.dirname(inputDir);
  if (!relay.createJob) throw new Error('Vlog Episode requires a planner-backed Relay Job client');
  let jobId;
  let created = false;
  {
    const identityFile = path.join(runDir, 'episode-job.json');
    const existing = await fs.readFile(identityFile, 'utf8').catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (existing) jobId = JSON.parse(existing).jobId;
    else {
      const objectiveFile = path.join(runDir, 'episode-objective.md');
      await fs.writeFile(objectiveFile, taskInput({ ...checked, runDir }));
      const job = await relay.createJob({ submissionId: checked.submissionId, objectiveFile });
      jobId = job.id ?? (typeof job.job === 'string' ? job.job : job.job?.id) ?? job.jobId;
      if (!jobId) throw new Error('Relay did not return an Episode Job ID');
      created = true;
      await fs.writeFile(identityFile, JSON.stringify({ jobId, submissionId: checked.submissionId }) + '\n', { flag: 'wx' });
    }
  }
  const receiptFile = path.join(runDir, 'episode-plan.json');
  const previousReceipt = await fs.readFile(receiptFile, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (previousReceipt) return { status: 'already-jobbed', jobId, runDir };
  if (!relay.planJob) throw new Error('Vlog Episode requires a Relay Planner action');
  const currentJob = relay.getJob ? await relay.getJob(jobId) : null;
  const plans = currentJob?.plans ?? [];
  // Legacy Jobs could already own durable Stage Tasks before Planner rounds
  // existed. Recover their intake receipt without submitting a duplicate Plan.
  const legacyTasks = plans.length === 0 && Array.isArray(currentJob?.tasks) && currentJob.tasks.length > 0;
  if (plans.some((plan) => plan.status === 'SUCCEEDED') || legacyTasks) {
    await fs.writeFile(receiptFile, JSON.stringify({ jobId, recovered: true, legacyTasks }) + '\n', { flag: 'wx' });
    return { status: 'already-jobbed', jobId, runDir };
  }
  if (plans.some((plan) => plan.status === 'PLANNING')) {
    return { status: 'job-planning', jobId, runDir };
  }
  if (plans.some((plan) => plan.status === 'FAILED')) {
    throw new Error(`Episode Job ${jobId} contains a failed Planner round; inspect and recover it before retry`);
  }
  await relay.planJob(jobId);
  await fs.writeFile(receiptFile, JSON.stringify({ jobId, planned: true }) + '\n', { flag: 'wx' });
  return { status: created ? 'job-planned' : 'plan-recovered', jobId, runDir };
}

export async function processSubmission(sourceDir, { runsDir, relay, now = new Date(), isLocallyAvailable } = {}) {
  const checked = await readAndValidateManifest(sourceDir, { isLocallyAvailable });
  const { day, hour } = localDateParts(now);
  const runDir = path.join(runsDir, day, hour, checked.submissionId);
  const inputDir = path.join(runDir, 'input');
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(path.join(runDir, 'manual-intake.json'), JSON.stringify({ submissionId: checked.submissionId }) + '\n', { flag: 'wx' }).catch((error) => { if (error.code !== 'EEXIST') throw error; });
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
