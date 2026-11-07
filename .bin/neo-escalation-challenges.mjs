import {createHash, randomUUID, randomBytes} from 'node:crypto';
import {
  mkdirSync, openSync, closeSync, writeFileSync, fsyncSync,
  linkSync, unlinkSync, renameSync, readFileSync, readdirSync, lstatSync, existsSync,
} from 'node:fs';
import {homedir} from 'node:os';
import {join, resolve} from 'node:path';

const DEFAULT_DIR = join(homedir(), '.local/share/neo/escalation/challenges');
const HEX_ID = /^[a-f0-9]{64}$/;
const STATUSES = new Set(['resolved', 'failed', 'needs_user']);
const STAGES = new Set(['preflight', 'resource_lock', 'setup', 'model_startup', 'agent_execution',
  'tool_execution', 'model_inference', 'result_parsing', 'experience_capture', 'cleanup', 'completed']);

function digest(text) { return createHash('sha256').update(text).digest('hex'); }

/** The input is always the original handoff, never a model-authored description. */
export function challengeSummary(handoff) {
  const lines = String(handoff || '').split(/\r?\n/)
    .map(line => line.trim().replace(/^[-*#>\s]+/, '').trim()).filter(Boolean);
  const field = (pattern) => {
    const found = lines.find(line => pattern.test(line));
    return found?.replace(/^[^:：]{1,38}[:：]\s*/, '') || '';
  };
  const goal = field(/^(?:goal|objective|task|request|目标|任务|目的|要求)\s*[:：]/i) || lines[0] || '';
  const blocker = field(/^(?:blocker|blocked|problem|error|issue|challenge|障碍|阻塞|失败|问题|错误|卡点)\s*[:：]/i) ||
    lines.find(line => /\b(?:blocked|missing|failed|can't|cannot|denied|unavailable)\b|阻塞|失败|缺少|无法|报错/i.test(line) && line !== goal) || '';
  const progress = field(/^(?:progress|current state|already tried|attempted|现状|进展|已尝试|已完成)\s*[:：]/i);
  const success = field(/^(?:success criteria|acceptance|expected result|verify|verification|完成标准|验收|预期结果|验证)\s*[:：]/i);
  // Descriptive headings are optional; always keep the exact handoff separately.
  // This ledger is private and intentionally does NOT redact or truncate values.
  return {goal, blocker, progress, success_criteria:success};
}

export function challengeDirectory(env = process.env) {
  const dir = env.NEO_ESCALATION_CHALLENGES_DIR || DEFAULT_DIR;
  if (typeof dir !== 'string' || !dir.startsWith('/')) throw new Error('NEO_ESCALATION_CHALLENGES_DIR must be an absolute path');
  return resolve(dir);
}

function privateDir(dir) {
  mkdirSync(dir, {recursive:true, mode:0o700});
  const stat = lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new Error('Challenge storage directory must be a private real directory (0700)');
  }
}

function immutableJson(path, value) {
  const folder = resolve(path, '..');
  privateDir(folder);
  if (existsSync(path)) return false;
  const scratch = join(folder, '.' + randomBytes(12).toString('hex') + '.tmp');
  const fd = openSync(scratch, 'wx', 0o600);
  try { writeFileSync(fd, JSON.stringify(value, null, 2)+'\n'); fsyncSync(fd); }
  finally { closeSync(fd); }
  try {
    linkSync(scratch, path);
    return true;
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  } finally { unlinkSync(scratch); }
}

/** Keep only the latest crash-recovery checkpoint; don't accumulate stage logs. */
function replaceCheckpoint(path, value) {
  const folder = resolve(path, '..');
  privateDir(folder);
  const scratch = join(folder, '.' + randomBytes(12).toString('hex') + '.tmp');
  const fd = openSync(scratch, 'wx', 0o600);
  try { writeFileSync(fd, JSON.stringify(value) + '\n'); fsyncSync(fd); }
  finally { closeSync(fd); }
  try { renameSync(scratch, path); }
  finally { if (existsSync(scratch)) unlinkSync(scratch); }
}

export function beginChallenge(request, {dir = challengeDirectory(), now = () => new Date().toISOString(), idFactory = randomUUID} = {}) {
  const handoff = request?.handoff;
  if (typeof handoff !== 'string' || !handoff.trim()) throw new Error('Challenge requires a handoff');
  if (request.correlationId !== undefined &&
    (typeof request.correlationId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:\/-]{5,159}$/.test(request.correlationId) ||
      request.correlationId.includes('..') || request.correlationId.includes('//'))) {
    throw new Error('Invalid --correlation-id (must be an opaque task ID, never a secret)');
  }
  const handoffFingerprint = digest(handoff);
  const challengeId = digest('neo-escalation-challenge-v1\u0000' + (request.correlationId || handoffFingerprint));
  // Protect the entire ledger root; a private child under a public parent
  // would still reveal challenge IDs and filenames.
  privateDir(dir);
  const folder = join(dir, challengeId);
  privateDir(folder);
  const createdAt = now();
  const challenge = {
    version:1, id:challengeId, created_at:createdAt,
    ...(request.correlationId ? {correlation_id:request.correlationId} : {}),
    cwd: request.cwd ?? null,
    handoff,
    ...challengeSummary(handoff),
  };
  const created = immutableJson(join(folder, 'challenge.json'), challenge);
  const originalHandoff = created ? handoff : JSON.parse(readFileSync(join(folder, 'challenge.json'), 'utf8')).handoff;
  const attemptId = idFactory();
  if (!/^[a-f0-9-]{36}$/i.test(attemptId)) throw new Error('Invalid attempt ID');
  const attempt = {version:1, challenge_id:challengeId, attempt_id:attemptId,
    event:'started', at:createdAt,
    // The challenge owns the initial handoff; only changed retry handoffs need a copy.
    ...(originalHandoff !== handoff ? {handoff} : {}),
  };
  immutableJson(join(folder, `${attemptId}.started.json`), attempt);
  return {challengeId, attemptId, dir};
}

export function failureInfo(error, phase = 'agent_execution') {
  if (!error) return null;
  const msg = typeof error.message === 'string' ? error.message : '';
  const patterns = [
    [/model server.*(?:launch|exited|startup)|inference server startup|server.*start.*timed out/i, 'model_startup', 'server_start_failed'],
    [/Local inference (?:request failed|HTTP \d+|returned no assistant)/i, 'model_inference', 'model_request_failed'],
    [/Local inference decision|decision gate|Local decision/i, 'model_inference', 'decision_failed'],
    [/budget expired|maximum tool-calling turns/i, 'agent_execution', 'agent_budget_exhausted'],
    [/returned no parseable JSON|emitted non-JSON|result must be a JSON|invalid status|needs a meaningful summary|did not provide a successful terminal result/i, 'result_parsing', 'invalid_agent_result'],
    [/claimed resolved without|Resolved local escalation has no evidence/i, 'result_parsing', 'verification_missing'],
    [/Local agent exited|Hermes dependency|Hermes installed/i, 'agent_execution', 'agent_process_failed'],
    [/lock|resource busy|exclusive model slot/i, 'resource_lock', 'resource_lock_failed'],
    [/permission|EACCES|EPERM/i, phase, 'permission_denied'],
  ];
  const hit = patterns.find(([re]) => re.test(msg));
  const stage = hit?.[1] || (STAGES.has(error.escalationStage) ? error.escalationStage : STAGES.has(phase) ? phase : 'agent_execution');
  const causes = [];
  const visited = new Set([error]);
  let current = error.cause;
  while (current && typeof current === 'object' && !visited.has(current) && causes.length < 4) {
    visited.add(current);
    causes.push({name:String(current.name || 'Error'), message:String(current.message || '')});
    current = current.cause;
  }
  return {
    stage, code:hit?.[2] || 'unclassified_runtime_error',
    error_class:String(error.name || 'Error'), message:msg,
    ...(causes.length ? {causes} : {}),
  };
}

export function checkpointChallenge(token, stage, {now = () => new Date().toISOString()} = {}) {
  if (!token || !HEX_ID.test(token.challengeId) || !/^[a-f0-9-]{36}$/i.test(token.attemptId)) {
    throw new Error('Invalid challenge token');
  }
  if (!STAGES.has(stage)) throw new Error('Invalid challenge stage');
  const folder = join(token.dir, token.challengeId);
  if (!existsSync(join(folder, `${token.attemptId}.started.json`))) throw new Error('Missing challenge attempt start event');
  if (existsSync(join(folder, `${token.attemptId}.finished.json`))) throw new Error('Completed attempt cannot be checkpointed');
  const event = {event:'checkpoint', at:now(), stage, challenge_id:token.challengeId, attempt_id:token.attemptId};
  replaceCheckpoint(join(folder, `${token.attemptId}.checkpoint.json`), event);
  return event;
}

export function finishChallenge(token, {result, error, phase, observation, experienceId, now = () => new Date().toISOString()} = {}) {
  if (!token || !HEX_ID.test(token.challengeId) || !/^[a-f0-9-]{36}$/i.test(token.attemptId)) throw new Error('Invalid challenge token');
  const folder = join(token.dir, token.challengeId);
  if (!existsSync(join(folder, `${token.attemptId}.started.json`))) throw new Error('Missing challenge attempt start event');
  const outcome = error ? 'failed' : result?.status;
  if (!STATUSES.has(outcome)) throw new Error('Invalid challenge outcome');
  // Completed attempts need a concise result, not all intermediate stages,
  // empty fields, duplicated handoffs, or exception stack traces.
  const failure = error ? failureInfo(error, phase) : (outcome === 'failed' ? {
    stage:STAGES.has(phase) ? phase : 'completed', code:'agent_reported_failure',
  } : null);
  const finish = {
    version:1, challenge_id:token.challengeId, attempt_id:token.attemptId,
    event:'finished', at:now(), outcome,
    ...(result?.summary ? {summary:result.summary} : {}),
    ...(result?.reason ? {reason:result.reason} : {}),
    ...(Array.isArray(result?.evidence) && result.evidence.length ? {verification:result.evidence} : {}),
    ...(outcome === 'needs_user' && result?.user_action ? {user_action:result.user_action} : {}),
    ...(outcome === 'needs_user' && result?.notification ? {notification:result.notification} : {}),
    ...(failure ? {failure} : {}),
    ...(observation && (observation.calls || observation.failures || observation.tools?.length) ? {observed:observation} : {}),
    ...(experienceId && HEX_ID.test(experienceId) ? {experience_id:experienceId} : {}),
  };
  immutableJson(join(folder, `${token.attemptId}.finished.json`), finish);
  // Only an unfinished attempt needs the latest stage checkpoint.
  const checkpoint = join(folder, `${token.attemptId}.checkpoint.json`);
  if (existsSync(checkpoint)) unlinkSync(checkpoint);
  return finish;
}

export function listChallenges({dir = challengeDirectory(), limit = 30, search = ''} = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('Challenge limit must be 1..200');
  if (!existsSync(dir)) return [];
  privateDir(dir);
  const entries = [];
  for (const id of readdirSync(dir).filter(name => HEX_ID.test(name))) {
    const folder = join(dir,id);
    if (!lstatSync(folder).isDirectory() || lstatSync(folder).isSymbolicLink()) continue;
    const file = join(folder,'challenge.json');
    if (!existsSync(file) || lstatSync(file).isSymbolicLink()) continue;
    const challenge = JSON.parse(readFileSync(file,'utf8'));
    if (challenge.version !== 1 || challenge.id !== id) continue;
    const attempts = [];
    const names = readdirSync(folder);
    for (const name of names.filter(name => /^[a-f0-9-]{36}\.(?:started|finished|checkpoint)\.json$/i.test(name))) {
      const path = join(folder,name);
      if (lstatSync(path).isSymbolicLink()) continue;
      const event = JSON.parse(readFileSync(path,'utf8'));
      if (event.challenge_id === id) {
        // A checkpoint is useful only when the attempt did not finish.
        if (event.event === 'checkpoint' && names.includes(`${event.attempt_id}.finished.json`)) continue;
        attempts.push(event);
      }
    }
    attempts.sort((a,b)=>a.at.localeCompare(b.at) ||
      a.attempt_id.localeCompare(b.attempt_id) ||
      ({started:0,checkpoint:1,finished:2}[a.event] - {started:0,checkpoint:1,finished:2}[b.event]));
    const lastEventAt = attempts.at(-1)?.at || challenge.created_at;
    const item = {...challenge, last_event_at:lastEventAt, attempts};
    if (!search || JSON.stringify(item).toLowerCase().includes(String(search).toLowerCase())) entries.push(item);
  }
  entries.sort((a,b)=>b.last_event_at.localeCompare(a.last_event_at) || b.created_at.localeCompare(a.created_at));
  return entries.slice(0,limit);
}
