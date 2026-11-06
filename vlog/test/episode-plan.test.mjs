import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const graph=read('../graph.mmd');
const lines=graph.trim().split('\n').slice(1).map(line=>line.trim());
const nodes=[{id:'visioner',agent:'vlog-visioner'},...lines.map(line=>{
 const [,id,agent]=line.match(/-->\s*([\w-]+)\[agent:([\w-]+)\]/)||[];
 return {id,agent};
})];
const edges=lines.map(line=>{
 const [,from,to]=line.match(/^([\w-]+)(?:\[agent:[\w-]+\])?\s*-->\s*([\w-]+)/)||[];
 return [from,to];
});
test('canonical graph has separate Publisher after Producer and no independent Final QA',()=>{
 assert.match(graph,/^flowchart TD/m);
 assert.deepEqual(nodes.map(x=>x.id),['visioner','director','editor','producer','publisher']);
 assert.deepEqual(edges,[['visioner','director'],['director','editor'],['editor','producer'],['producer','publisher']]);
 for(const {agent} of nodes)assert.match(read('../agents/'+agent+'.agent.md'),new RegExp('name: '+agent));
});
test('Planner derives dependencies from graph, and conditional Publisher requires authorization',()=>{
 const planner=read('../agents/planner.agent.md'),project=read('../AGENTS.md');
 for(const pattern of [/graph\.mmd/,/first successful Episode Plan/,/every normal Stage node/,/dependencies/,/Later Plan rounds/])assert.match(planner,pattern);
 assert.match(planner,/Publisher Agent/);
 assert.match(project,/publisher-request\.json/);
 assert.doesNotMatch(project,/mandatory independent Final Review/);
});
test('Stage ownership is unambiguous: Editor authors, Producer executes, Publisher posts',()=>{
 for(const {agent} of nodes.slice(1)){
  const role=read('../agents/'+agent+'.agent.md');
  assert.match(role,/inputs:/);assert.match(role,/outputs:/);
 }
 assert.match(read('../agents/vlog-editor.agent.md'),/complete executable Markcut/);
 assert.match(read('../agents/vlog-producer.agent.md'),/Shortcut-first/);
 assert.match(read('../agents/vlog-publisher.agent.md'),/WebHelm/);
});
test('on-demand human Preview is separate from viewer self-check and publishing',()=>{
 const stage=read('../docs/episode-stage-contract.md');
 const editor=read('../agents/vlog-editor.agent.md'),producer=read('../agents/vlog-producer.agent.md');
 assert.match(stage,/no human preview is/);
 assert.match(editor,/NOT \x60--delivery event\x60/);
 assert.match(producer,/Only on demand/);
 assert.match(stage,/Publisher requires.*no interactive review/s);
 assert.doesNotMatch(stage,/Producer must obtain.*interactive owner approval/);
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

test('Visioner has source-linked responsibility, without manufacturing a movie',()=>{
 const visioner=read('../agents/vlog-visioner.agent.md'),stage=read('../docs/episode-stage-contract.md');
 assert.match(visioner,/^name: vlog-visioner$/m);
 assert.match(visioner,/vision-evidence.json/);
 assert.match(stage,/source index/);
 assert.match(stage,/source-linked/);
});
