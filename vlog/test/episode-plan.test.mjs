import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { episodeTaskId, EPISODE_STAGES, validateEpisodePlan } from '../scripts/validate-episode-plan.mjs';

const submissionId = 'episode-123';
const runDirectory = '/vlog/runs/2026-10-26/episode-123';
const id = stage => episodeTaskId(stage, submissionId);
const parents = {
  visioner: [], editor: ['visioner'], producer: ['editor'],
  'final-qa': ['producer'],
};
const artifact = {
  visioner: 'vision-evidence.json',
  editor: 'visual-brief.md',
  producer: 'video.md',
  'final-qa': 'qa.md',
};
const makeTask = stage => ({
  id: id(stage),
  title: `Complete Vlog ${stage} evidence and review`,
  input: `Do ${stage} work with source evidence from ${runDirectory}/input/manifest.json and preserve accepted output.`,
  storySize: 'M',
  agentName: stage === 'visioner' ? 'visioner' : stage === 'market' ? 'market' : 'vlog-producer',
  parentTaskId: stage === 'visioner' ? null : id('visioner'),
  dependencies: parents[stage].map(id),
  output: { kind: 'file', path: `${runDirectory}/${artifact[stage]}` },
});
const complete = () => ({
  objective_status: 'in_progress',
  assessment: 'Vlog Episode graph-first task plan',
  next_tasks: EPISODE_STAGES.map(makeTask),
});
const check = (plan, existingTasks = []) =>
  validateEpisodePlan(plan, { submissionId, runDirectory, existingTasks });

test('validator stage inventory matches the authoritative Vlog Graph', () => {
  const contract = readFileSync(new URL('../AGENTS.md', import.meta.url), 'utf8');
  const planner = readFileSync(new URL('../agents/planner.agent.md', import.meta.url), 'utf8');
  for (const label of ['Visioner (', 'Vlog Editor (', 'Vlog Producer (', 'Final render and technical QA (']) {
    assert.ok(contract.includes(label), `Canonical Graph missing ${label}`);
  }
  assert.ok(contract.includes('Optional source Human Review'));
  for (const stage of EPISODE_STAGES) assert.ok(planner.includes(`\`${stage}\``), `Planner missing ${stage}`);
});

test('accepts ordered agent outcomes, with reviews internal to Producer', () => {
  assert.deepEqual(check(complete()), []);
  assert.deepEqual(EPISODE_STAGES, ['visioner', 'editor', 'producer', 'final-qa']);
  assert.deepEqual(complete().next_tasks.find(x => x.id === id('final-qa')).dependencies, [id('producer')]);
  const planner = readFileSync(new URL('../agents/planner.agent.md', import.meta.url), 'utf8');
  assert.ok(planner.includes('agents-relay review run'));
  assert.ok(planner.includes('--agents video-director,market'));
});

test('accepts staged planning using already-durable root and predecessors', () => {
  const plan = { objective_status: 'in_progress', next_tasks: [makeTask('producer')] };
  assert.deepEqual(check(plan, [id('visioner'), id('editor')]), []);
});

test('rejects missing stage dependency and obsolete review Task', () => {
  const plan = complete();
  plan.next_tasks.find(x => x.id === id('final-qa')).dependencies = [];
  plan.next_tasks.push({ ...makeTask('producer'), id: 'vlog-market-review-episode-123' });
  const issues = check(plan);
  assert.ok(issues.some(x => x.includes('missing dependency ' + id('producer'))));
  assert.ok(issues.some(x => x.includes('Unexpected Episode stage')));
});

test('rejects invalid parent, unknown stage, graph nesting and output escape', () => {
  const plan = complete();
  plan.next_tasks.find(x => x.id === id('editor')).parentTaskId = null;
  plan.next_tasks.find(x => x.id === id('producer')).agentGraph = 'flowchart LR\n  a[agent:a]';
  plan.next_tasks.find(x => x.id === id('visioner')).output.path = '/tmp/unrelated.json';
  plan.next_tasks.push({ ...makeTask('editor'), id: 'invented-review-node' });
  const issues = check(plan);
  assert.ok(issues.some(x => x.includes('invalid parentTaskId')));
  assert.ok(issues.some(x => x.includes('nested agentGraph')));
  assert.ok(issues.some(x => x.includes('canonical run_directory')));
  assert.ok(issues.some(x => x.includes('Unexpected Episode stage')));
});

test('rejects completion without the full mandatory stage tree', () => {
  assert.ok(check({
    objective_status: 'satisfied', next_tasks: [],
  }, [id('visioner')]).some(x => x.includes('missing mandatory')));
});

test('rejects a later stage whose prerequisites do not exist', () => {
  const plan = { objective_status: 'in_progress', next_tasks: [makeTask('producer')] };
  assert.ok(check(plan, [id('visioner')]).some(x => x.includes('dependency Task not created')));
});

test('requires Visioner to resolve media from the source manifest', () => {
  const plan = complete();
  plan.next_tasks[0].input = 'Inspect the existing Markcut perception.';
  assert.ok(check(plan).some(issue => issue.includes('must reference the source manifest')));
});

test('Visioner contract uses Markcut skill, canonical output and environment-aware inference', () => {
  const contract = readFileSync(new URL('../../agents/visioner.agent.md', import.meta.url), 'utf8');
  const planner = readFileSync(new URL('../agents/planner.agent.md', import.meta.url), 'utf8');
  const stageContract = readFileSync(new URL('../docs/episode-stage-contract.md', import.meta.url), 'utf8');
  for (const required of ['name: visioner', 'markcut', 'npx @lalalic/markcut vision', 'ITT', 'VTT', 'remote', 'local']) {
    assert.ok(contract.includes(required), `Shared Visioner missing ${required}`);
  }
  for (const required of ['input/media/metadata.json', 'perception.desc', 'vision-evidence.json']) {
    assert.ok(stageContract.includes(required), `Vlog stage contract missing ${required}`);
  }
  assert.ok(planner.includes('shared Neo Visioner'));
  assert.ok(stageContract.includes('Markcut owns ITT'));
});
