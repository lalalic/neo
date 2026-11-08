import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';

const root=new URL('../../',import.meta.url);
test('every current Neo Project-local worker role has a capability-based prompt eval',()=>{
 const output=execFileSync(process.execPath,[new URL('../../scripts/audit-project-worker-evals.mjs',import.meta.url).pathname],{encoding:'utf8'});
 assert.match(output,/"rolesWithoutCases": \[\]/);
});
test('Vlog model eval scenarios encode distinct executable choices, not generic L4 transport',()=>{
 const cases=JSON.parse(readFileSync(new URL('../.evals/cases.json',import.meta.url),'utf8'));
 assert.ok(cases.length>=10);
 assert.equal(new Set(cases.map(c=>c.id)).size,cases.length);
 for(const c of cases){
  assert.ok(c.capability,c.id);
  if(c.type==='node-tests'){
   assert.ok(c.testFiles.length>=1,c.id);
   continue;
  }
  assert.ok(c.task.length>=45,c.id);
  assert.ok(c.choices.length>=3&&new Set(c.choices).size===c.choices.length,c.id);
  assert.ok(c.choices.includes(c.expectedDecision),c.id);
 }
 assert.ok(cases.some(c=>c.role==='vlog-producer'&&c.capability==='template song identity'));
 assert.ok(cases.some(c=>c.role==='vlog-producer'&&c.capability==='executable story realization'));
 assert.ok(cases.some(c=>c.id==='template-verify'&&c.type==='node-tests'&&c.testFiles.includes('test/worknode-chattts-contract.test.mjs')&&c.testFiles.includes('test/vlog-publisher-shortcut.test.mjs')));
});
