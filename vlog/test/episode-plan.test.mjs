import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const graph = read('../graph.mmd');
const lines = graph.trim().split('\n').slice(1).map(line => line.trim());
const nodes = [{ id: 'visioner', agent: 'vlog-visioner' }, ...lines.map(line => {
  const [, id, agent] = line.match(/-->\s*([\w-]+)\[agent:([\w-]+)\]/) || [];
  return { id, agent };
})];
const edges = lines.map(line => {
  const [, from, to] = line.match(/^([\w-]+)(?:\[agent:[\w-]+\])?\s*-->\s*([\w-]+)/) || [];
  return [from, to];
});

test('canonical graph contains resolvable specialist agents', () => {
  assert.match(graph, /^flowchart TD/m);
  assert.deepEqual(nodes.map(x => x.id), ['visioner', 'director', 'editor', 'producer', 'final_qa']);
  assert.deepEqual(edges, [['visioner', 'director'], ['director', 'editor'], ['editor', 'producer'], ['producer', 'final_qa']]);
  for (const { agent } of nodes) {
    const path = '../agents/' + agent + '.agent.md';
    assert.ok(read(path).includes('name: ' + agent));
  }
});

test('planner derives dependencies from graph and permits incremental revisions', () => {
  const planner = read('../agents/planner.agent.md');
  const project = read('../AGENTS.md');
  assert.match(planner, /graph\.mmd/);
  assert.match(planner, /first successful Episode Plan/);
  assert.match(planner, /every normal Stage node/);
  assert.match(planner, /Do not wait for Visioner to complete/);
  assert.match(planner, /dependencies.*keep downstream Tasks waiting/);
  assert.match(planner, /Later Plan rounds/);
  assert.match(planner, /parentless|no parent/i);
  assert.match(project, /initial Plan creates all five normal Stage Tasks with predecessor dependencies/);
  assert.match(project, /graph\.mmd/);
  assert.doesNotMatch(planner, /validate-episode-plan/);
  assert.doesNotMatch(project, /validate-episode-plan/);
});

test('stage Agent frontmatter declares inputs, outputs and optional reviewers', () => {
  for (const { agent } of nodes.filter(x => x.agent !== 'vlog-visioner')) {
    const contract = read('../agents/' + agent + '.agent.md');
    for (const key of ['inputs:', 'outputs:']) assert.ok(contract.includes(key), agent + ':' + key);
  }
  assert.match(read('../agents/vlog-producer.agent.md'), /reviewers:/);
});

test('human preview gate is in-Worker, revision-bound and independent of publishing', () => {
  const stage = read('../docs/episode-stage-contract.md');
  const planner = read('../agents/planner.agent.md');
  const producer = read('../agents/vlog-producer.agent.md');
  const finalQa = read('../agents/vlog-final-qa.agent.md');
  assert.match(stage, /Producer must obtain \*\*interactive owner approval/);
  assert.match(stage, /Visioner, Director and Editor may request optional/);
  assert.match(stage, /temporary Markcut source preview/);
  assert.match(stage, /not Producer approval/);
  assert.match(read('../agents/vlog-director.agent.md'), /temporary Markcut/);
  assert.match(planner, /interactive.*Worker|preview capability/);
  assert.match(producer, /neo\.markcut_preview/);
  assert.match(producer, /On changes, repair and preview again/);
  assert.match(producer, /same Worker/);
  assert.match(producer, /revisionId.*contentHash/);
  assert.match(finalQa, /human Markcut Preview approval/);
  assert.match(producer, /separate publishing workflow/);
  assert.doesNotMatch(stage, /Corrections create a new Relay task/);
});

test('artifact schemas are explicit and require source traceability', () => {
  for (const name of ['shot-selection', 'edit-decision-list']) {
    const schema = JSON.parse(read('../contracts/' + name + '.schema.json'));
    assert.equal(schema.type, 'object');
    assert.equal(schema.properties.schema_version.const, 1);
    assert.ok(schema.required.includes('schema_version'));
  }
  const shot = JSON.parse(read('../contracts/shot-selection.schema.json'));
  assert.ok(shot.properties.shots.items.required.includes('source_hash'));
});

test('Vlog Visioner owns source semantics and inherits generic Markcut Vision capability', () => {
  const visioner = read('../agents/vlog-visioner.agent.md');
  const shared = read('../../agents/visioner.agent.md');
  const stage = read('../docs/episode-stage-contract.md');
  assert.match(visioner, /^name: vlog-visioner$/m);
  assert.match(visioner, /^extends: \/Users\/chengli\/Workspace\/neo\/agents\/visioner\.agent\.md$/m);
  for (const word of ['source-manifest.json', 'Project-specific source segmentation', 'DeepSeek Web', 'vision-evidence.json']) {
    assert.ok(visioner.includes(word), word);
  }
  for (const word of ['name: visioner', 'markcut', 'npx @lalalic/markcut vision',
    'Optional human source preview', 'provisional Markcut `video.md`', 'neo.markcut_preview', 'same Worker',
    'one media item per top-level Scene', 'one aggregate `video.md`', 'horizontal scene list', 'folder path directly']) {
    assert.ok(shared.includes(word), word);
  }
  for (const word of ['input/media/metadata.json', 'perception.desc', 'vision-evidence.json']) assert.ok(stage.includes(word));
});
