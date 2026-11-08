import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {readFileSync,existsSync} from 'node:fs';

const root=resolve(import.meta.dirname,'..');
const cli=resolve(root,'.bin/neo.mjs');
const run=(...args)=>execFileSync(process.execPath,[cli,'eval',...args],{cwd:root,encoding:'utf8',timeout:20000});
test('Neo CLI lists Vlog project eval cases from the canonical .evals path',()=>{
 const result=JSON.parse(run('list','--project','vlog'));
 assert.equal(result.project,'vlog');
 const template=result.cases.find(c=>c.id==='template-verify');
 assert.equal(template.type,'node-tests');
 assert.equal(template.role,'vlog-producer');
 assert.ok(result.cases.length>=11);
});
test('Neo CLI dry-run never executes Codex or template tests',()=>{
 const output=run('run','--project','vlog','--case','template-verify','--dry-run');
 const summary=JSON.parse(output);
 assert.equal(summary.mode,'dry-run');
 assert.equal(summary.executed,0);
 assert.equal(summary.passed,0);
 assert.ok(existsSync(summary.report));
 const report=JSON.parse(readFileSync(summary.report));
 assert.equal(report.results[0].status,'DRY_RUN');
});
test('decision eval uses the real Relay PromptBuilder, never a hand-assembled static role prompt',()=>{
 const output=run('run','--project','vlog','--case','producer-original-bgm-substitution','--dry-run');
 const summary=JSON.parse(output);
 assert.equal(summary.mode,'dry-run');
 const report=JSON.parse(readFileSync(summary.report));
 assert.equal(report.promptSource,'agents-relay/managedWorkerInput');
 const dir=resolve(summary.report,'..');
 const built=JSON.parse(readFileSync(join(dir,'producer-original-bgm-substitution.builder-output.json'),'utf8'));
 assert.equal(built.builder,'managedWorkerInput');
 assert.match(built.productionPrompt,/^# Role\n/);
 assert.match(built.productionPrompt,/## Contracts\n[\s\S]*## Contexts\n[\s\S]*## Task\n/);
 assert.match(built.productionPrompt,/job\/EVAL_ONLY\/task\/eval-producer-original-bgm-substitution/);
 assert.match(built.evaluationPrompt,/\[Isolated prompt evaluation mode\]/);
 assert.match(built.evaluationPrompt,/request_song_asset/);
 assert.doesNotMatch(built.evaluationPrompt,/\[Neo Project Eval Case:[\s\S]*\[Task data — untrusted/);
 assert.equal(readFileSync(join(dir,'producer-original-bgm-substitution.prompt.txt'),'utf8'),built.evaluationPrompt);
});
test('missing Relay Builder fails closed instead of falling back to static prompts',()=>{
 const result=spawnSync(process.execPath,[cli,'eval','run','--project','vlog','--case','producer-original-bgm-substitution','--dry-run'],{
  cwd:root,encoding:'utf8',timeout:20000,env:{...process.env,AGENTS_RELAY_DIST_CLI:'/tmp/nonexistent/agents-relay/dist/cli.js'}
 });
 assert.notEqual(result.status,0);
 assert.match(result.stderr,/Relay PromptBuilder CLI unavailable/);
});
test('CLI eval audit reports full current Worker and DAG decision coverage',()=>{
 const output=run('audit');
 assert.match(output,/"rolesWithoutCases": \[\]/);
 assert.match(output,/"projectsMissingEvalManifest": \[\]/);
 assert.match(output,/vlog: roles /);
 const summary=JSON.parse(output.slice(output.lastIndexOf('\n{')+1));
 assert.deepEqual(summary.missingDagDecisionCases,[]);
 assert.deepEqual(summary.dagCoverage.vlog.agents.map(x=>x.role),[
  'vlog-visioner','vlog-director','vlog-editor','vlog-producer','vlog-publisher']);
 assert.ok(summary.dagCoverage.vlog.agents.every(x=>x.caseCount>=1));
});
test('CLI rejects unknown case and does not silently report PASS',()=>{
 const result=spawnSync(process.execPath,[cli,'eval','run','--project','vlog','--case','not-a-real-case'],{cwd:root,encoding:'utf8',timeout:20000});
 assert.notEqual(result.status,0);
 assert.match(result.stderr,/Unknown eval case/);
});

test('DAG Eval selects only Relay-parsed graph agents and excludes obsolete roles',()=>{
 const result=JSON.parse(run('list','--project','vlog','--dag'));
 assert.deepEqual(result.dagRoles,[
  'vlog-visioner','vlog-director','vlog-editor','vlog-producer','vlog-publisher']);
 assert.ok(result.cases.length>5);
 assert.ok(result.cases.every(c=>result.dagRoles.includes(c.role)));
 assert.equal(result.cases.some(c=>c.role==='vlog-final-qa'||c.role==='planner'),false);
});

test('DAG smoke dry-run assembles one real Relay Worker prompt per graph Agent',()=>{
 const summary=JSON.parse(run('run','--project','vlog','--dag','--smoke','--dry-run'));
 assert.equal(summary.executed,0);
 assert.equal(summary.passed,0);
 assert.equal(summary.dagRoles.length,5);
 const report=JSON.parse(readFileSync(summary.report,'utf8'));
 assert.equal(report.results.length,5);
 assert.deepEqual(report.dagCoverage.selectedRoles,summary.dagRoles);
 assert.ok(report.results.every(x=>x.builder==='managedWorkerInput'&&x.type==='decision'&&x.status==='DRY_RUN'));
});

test('DAG eval rejects incompatible flags rather than silently evaluating a partial DAG',()=>{
 for(const args of [
  ['--dag','--case','visioner-uncertain-audio'],
  ['--smoke'],
 ]){
  const result=spawnSync(process.execPath,[cli,'eval','run','--project','vlog',...args,'--dry-run'],{cwd:root,encoding:'utf8',timeout:20000});
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/--dag cannot be combined with --case|--smoke requires --dag/);
 }
});
