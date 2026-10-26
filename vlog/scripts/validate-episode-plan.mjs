#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const EPISODE_STAGES = Object.freeze([
  'visioner', 'editor', 'producer', 'final-qa',
]);
const PREDECESSORS = Object.freeze({
  visioner: [],
  editor: ['visioner'],
  producer: ['editor'],
  'final-qa': ['producer'],
});

export function episodeTaskId(stage, submissionId) {
  if (!EPISODE_STAGES.includes(stage)) throw new Error(`Unknown Vlog stage: ${stage}`);
  return stage === 'visioner'
    ? `vlog-episode-${submissionId}`
    : `vlog-${stage}-${submissionId}`;
}

/** Additional Vlog-only check before Relay's authoritative plan apply.
 * Existing task IDs permit later Plan rounds to append new descendants.
 * This is deliberately NOT an alternative SQLite/Relay state authority.
 */
export function validateEpisodePlan(plan, { submissionId, runDirectory, existingTasks = [] }) {
  const issues = [];
  const fail = (message) => issues.push(message);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(submissionId ?? '')) {
    return ['Unsafe or missing submission_id'];
  }
  if (!path.isAbsolute(runDirectory ?? '')) return ['run_directory must be absolute'];
  if (!plan || !Array.isArray(plan.next_tasks)) return ['next_tasks array is required'];
  const root = episodeTaskId('visioner', submissionId);
  const stages = new Map(EPISODE_STAGES.map(stage => [episodeTaskId(stage, submissionId), stage]));
  const prior = new Set(existingTasks.map(task => typeof task === 'string' ? task : task.id));
  const fresh = new Map();
  for (const task of plan.next_tasks) {
    if (!task || typeof task.id !== 'string') { fail('Task ID is required'); continue; }
    if (!stages.has(task.id) && !(task.resolution || task.review)) { fail(`Unexpected Episode stage Task: ${task.id}`); continue; }
    if (fresh.has(task.id) || prior.has(task.id)) fail(`Duplicate existing/new Task: ${task.id}`);
    fresh.set(task.id, task);
  }
  const known = new Set([...prior, ...fresh.keys()]);
  if (plan.objective_status !== 'satisfied' && !known.has(root)) {
    fail(`Missing top-level Visioner Task: ${root}`);
  }
  for (const [id, task] of fresh) {
    const stage = stages.get(id);
    if (id === root ? task.parentTaskId != null : task.parentTaskId !== root) {
      fail(`${id}: invalid parentTaskId, expected ${id === root ? 'null' : root}`);
    }
    if (!task.agentName || typeof task.agentName !== 'string') fail(`${id}: one accountable agentName is required`);
    if (task.agentGraph) fail(`${id}: nested agentGraph is forbidden in Multi-Task prototype`);
    if (!Array.isArray(task.dependencies)) fail(`${id}: dependencies array is required`);
    const expected = stage ? PREDECESSORS[stage].map(parentStage => episodeTaskId(parentStage, submissionId)) : [];
    const deps = new Set(task.dependencies ?? []);
    for (const dependency of expected) {
      if (!deps.has(dependency)) fail(`${id}: missing dependency ${dependency}`);
      if (!known.has(dependency)) fail(`${id}: dependency Task not created or existing: ${dependency}`);
    }
    for (const dep of deps) {
      if (stage && !expected.includes(dep)) fail(`${id}: unexpected dependency ${dep}`);
      if (!known.has(dep)) fail(`${id}: unknown dependency ${dep}`);
    }
    if (!stage && deps.size === 0) fail(`${id}: review/recovery Task requires an explicit dependency`);
    if (!task.output || task.output.kind !== 'file' || typeof task.output.path !== 'string') {
      fail(`${id}: file output is required`);
    } else {
      const file = path.resolve(task.output.path);
      const relative = path.relative(runDirectory, file);
      if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
        fail(`${id}: output must be inside the canonical run_directory`);
      }
    }
    if (!task.input?.trim()) fail(`${id}: input contract is required`);
    if (stage === 'visioner' && !/manifest\.json\b/.test(task.input ?? '')) {
      fail(`${id}: Visioner must reference the source manifest path`);
    }
  }
  if (plan.objective_status === 'satisfied' && EPISODE_STAGES.some(stage =>
    !known.has(episodeTaskId(stage, submissionId)))) {
    fail('Cannot claim objective satisfied with missing mandatory Episode stage Tasks');
  }
  return issues;
}

function option(args, flag) {
  const position = args.indexOf(flag);
  return position < 0 ? undefined : args[position + 1];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const input = option(args, '--file');
  const submissionId = option(args, '--submission-id');
  const runDirectory = option(args, '--run-dir');
  const existingFile = option(args, '--existing-file');
  if (!input || !submissionId || !runDirectory) {
    process.stderr.write('usage: validate-episode-plan.mjs --file PLAN.json --submission-id ID --run-dir ABS_PATH [--existing-file TASKS.json]\n');
    process.exitCode = 2;
  } else {
    try {
      const plan = JSON.parse(readFileSync(input, 'utf8'));
      const existingTasks = existingFile ? JSON.parse(readFileSync(existingFile, 'utf8')) : [];
      const issues = validateEpisodePlan(plan, { submissionId, runDirectory, existingTasks });
      process.stdout.write(JSON.stringify({ valid: issues.length === 0, issues }) + '\n');
      if (issues.length) process.exitCode = 1;
    } catch (error) {
      process.stderr.write(`Plan validation failed: ${error.message}\n`);
      process.exitCode = 2;
    }
  }
}
