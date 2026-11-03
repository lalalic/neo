import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const project = dirname(dirname(fileURLToPath(import.meta.url)));
const read = relative => readFileSync(join(project, relative), 'utf8');

function declarations() {
  const source = read('graph.mmd');
  const lines = source.trim().split(/\r?\n/);
  assert.match(lines.shift(), /^flowchart (TD|TB|LR|RL)$/);
  const nodes = new Map(), edges = [];
  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith('%%')) continue;
    const match = line.trim().match(/^([a-z][a-z0-9-]*)(?:\[agent:([a-z][a-z0-9-]*)\])?\s*-->\s*([a-z][a-z0-9-]*)(?:\[agent:([a-z][a-z0-9-]*)\])?$/);
    assert.ok(match, 'unsupported Relay Graph edge: ' + line);
    const [, left, leftAgent, right, rightAgent] = match;
    for (const [id, suppliedRole] of [[left, leftAgent], [right, rightAgent]]) {
      const role = suppliedRole || nodes.get(id);
      assert.ok(role, 'Graph node has no declared agent: ' + id);
      if (nodes.has(id)) assert.equal(nodes.get(id), role);
      nodes.set(id, role);
    }
    edges.push([left, right]);
  }
  return {nodes,edges};
}
function declaredList(role, field) {
  const source = read('agents/' + role + '.agent.md');
  const front = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  assert.ok(front, 'missing manifest frontmatter: ' + role);
  assert.match(front[1], new RegExp('^name: ' + role + '$','m'));
  const list = front[1].match(new RegExp('^' + field + ':\\s*\\n((?:  - [^\\n]+\\n?)*)', 'm'));
  return list ? [...list[1].matchAll(/^  - ([a-z0-9-]+)$/gm)].map(m=>m[1]) : [];
}

test('actual Neo project graph has complete declarative artifact handoffs', () => {
  const {nodes,edges} = declarations();
  assert.equal(nodes.size, 9);
  assert.equal(edges.length, nodes.size - 1);
  const outputNames = new Set();
  const ownership = new Map();
  const visited = new Set();
  for (const [id,role] of nodes) {
    assert.ok(existsSync(join(project,'agents',role+'.agent.md')));
    for (const name of declaredList(role,'inputs')) {
      assert.ok(outputNames.has(name), role + ' needs missing upstream artifact ' + name);
    }
    for (const name of declaredList(role,'outputs')) {
      assert.equal(ownership.has(name), false, 'duplicate owner for '+name);
      ownership.set(name,role);
      outputNames.add(name);
    }
    visited.add(id);
  }
  assert.equal(visited.size,9);
  const handoffs=read('contracts/artifact-handoffs.md');
  for(const [artifact,owner] of ownership){
    assert.ok(handoffs.includes('`'+artifact+'`'), owner+' output lacks project handoff contract: '+artifact);
  }
  assert.match(handoffs, /\*\*same canonical, Git-ignored\*\*/);
  assert.match(handoffs, /one Task lifecycle/);
});

test('Neo project run declaration is URL-only with recovery through a bound path',()=>{
  const doc=JSON.parse(read('project.run.json'));
  assert.equal(doc.schemaVersion,1);
  assert.deepEqual(doc.input,{type:'url',schemes:['https'],resumePath:true});
  assert.match(read('AGENTS.md'), /source reference only|only a reference/i);
  assert.match(read('README.md'), /neo project run --url=/);
  assert.ok(!existsSync(join(project,'neo-project')), 'pure Agent project must not invent lifecycle services');
});

test('acquirer hands off source paths; only planner authors campaign.json',()=>{
  const acquirer=read('agents/distribution-acquirer.agent.md');
  const planner=read('agents/distribution-planner.agent.md');
  assert.match(acquirer, /Planner, which alone authors `campaign\.json`/);
  assert.match(planner, /Produce `campaign\.json`/);
  assert.match(read('contracts/artifact-handoffs.md'), /authored by the Planner only/);
});

test('Visioner uses supported Markcut Vision flags and consumes VTT as Agent evidence',()=>{
  const vision=read('agents/distribution-visioner.agent.md');
  const overview=read('README.md');
  assert.match(vision,/\`--instruct\`/);
  assert.match(vision,/\`--skip-stt\`/);
  assert.match(vision,/does \*\*not\*\* advertise a `--transcript-file` input/);
  assert.match(vision,/full named WebVTT \*\*as Agent evidence\*\*/);
  assert.match(overview,/does \*\*not\*\* advertise `--transcript-file`/);
  assert.match(read('agents/distribution-producer.agent.md'),/Do not repeat Video Use STT/);
});
