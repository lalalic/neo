import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, mkdirSync, chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  beginChallenge, checkpointChallenge, finishChallenge, failureInfo,
  listChallenges, challengeSummary, challengeDirectory,
} from '../.bin/neo-escalation-challenges.mjs';

const root = mkdtempSync(join(tmpdir(), 'neo-escalation-challenges-test-'));
const cli = fileURLToPath(new URL('../.bin/neo.mjs', import.meta.url));
process.on('exit', () => rmSync(root, {recursive:true, force:true}));
const fixture = `Goal: restore authorization for deploy\nBlocker: key=abcd1234 at /Users/alice/.secrets/token.txt\nProgress: attempted 'wrangler secret put'\nSuccess criteria: verify in Cloudflare\nFull note: URL https://example.test/auth?token=abc\n`;
const store = name => join(root,name);

test('challenge is persisted before local model use, full unredacted handoff and strict file modes', () => {
  const dir = store('first');
  const token = beginChallenge({handoff:fixture,correlationId:'job/demo/task/auth'}, {dir});
  const folder = join(dir,token.challengeId);
  const challenge = JSON.parse(readFileSync(join(folder,'challenge.json'),'utf8'));
  const started = JSON.parse(readFileSync(join(folder,token.attemptId+'.started.json'),'utf8'));
  assert.equal(challenge.handoff,fixture);
  assert.equal(challenge.blocker,'key=abcd1234 at /Users/alice/.secrets/token.txt');
  assert.equal(challenge.progress,"attempted 'wrangler secret put'");
  assert.equal(challenge.correlation_id,'job/demo/task/auth');
  assert.equal(challenge.cwd,null);
  assert.equal(started.handoff,undefined); // Full handoff is stored only once in Challenge
  assert.equal(started.event,'started');
  assert.equal(statSync(folder).mode & 0o777,0o700);
  assert.equal(statSync(join(folder,'challenge.json')).mode & 0o777,0o600);
  assert.equal(statSync(join(folder,token.attemptId+'.started.json')).mode & 0o777,0o600);
  const rows = listChallenges({dir});
  assert.equal(rows[0].attempts.length,1);
  assert.ok(!rows[0].attempts.some(a=>a.event==='finished'));
});

test('compact attempts preserve raw failure causes and retries without stage-log files',()=>{
  const dir = store('retries');
  const first = beginChallenge({handoff:fixture,correlationId:'job/demo/task/auth'}, {dir});
  checkpointChallenge(first,'model_startup');
  const cause=new Error('ECONNREFUSED https://private.example/connect?token=abcd');
  const err=new Error('Local inference request failed', {cause});
  const failure=finishChallenge(first,{error:err,phase:'agent_execution',observation:{tools:['shell'],calls:2,failures:1}});
  assert.equal(failure.failure.stage,'model_inference');
  assert.equal(failure.failure.code,'model_request_failed');
  assert.equal(failure.failure.causes[0].message,cause.message);
  assert.equal(failure.failure.stack,undefined);
  assert.equal(failure.failure.causes[0].stack,undefined);
  assert.equal(failure.observed.calls,2);
  const second=beginChallenge({handoff:fixture+'New progress: backup found\n',correlationId:'job/demo/task/auth'}, {dir});
  assert.equal(second.challengeId,first.challengeId);
  assert.notEqual(second.attemptId,first.attemptId);
  checkpointChallenge(second,'tool_execution');
  const verified='Success key=abcd1234, https://private.example/verified';
  const success=finishChallenge(second,{result:{status:'resolved',summary:verified,reason:null,evidence:[verified]},phase:'completed'});
  assert.equal(success.summary,verified);
  assert.equal(success.failure,undefined);
  assert.deepEqual(success.verification,[verified]);
  const rows=listChallenges({dir,search:'job/demo/task/auth'});
  assert.equal(rows.length,1);
  assert.equal(rows[0].attempts.filter(a=>a.event==='started').length,2);
  assert.equal(rows[0].attempts.filter(a=>a.event==='finished').length,2);
  assert.equal(rows[0].attempts.filter(a=>a.event==='checkpoint').length,0); // Success/failure cleans stage logs
  assert.equal(readdirSync(join(dir,first.challengeId)).filter(x=>x.endsWith('.json')).length,5);
  assert.ok(rows[0].attempts.some(a=>a.event==='started'&&a.handoff?.includes('backup found')));
});

test('needs_user keeps actionable notification and omits empty diagnostic noise',()=>{
  const dir=store('needs-user');
  const token=beginChallenge({handoff:'Goal: authenticate\nBlocker: MFA required'}, {dir});
  checkpointChallenge(token,'agent_execution');
  const notification={attempted:true,delivered:true,channel:'imessage',details:'Sent to owner'};
  const result={status:'needs_user',summary:'OTP required',user_action:'Approve the login',notification,evidence:[]};
  const done=finishChallenge(token,{result,phase:'completed'});
  assert.equal(done.user_action,'Approve the login');
  assert.deepEqual(done.notification,notification);
  for (const absent of ['reason','verification','failure','observed','experience_id']) {
    assert.equal(Object.hasOwn(done,absent),false,absent+' should not exist');
  }
  assert.equal(readdirSync(join(dir,token.challengeId)).filter(n=>n.endsWith('.json')).length,3);
});

test('agent-reported failure retains the verbatim failure explanation',()=>{
  const dir=store('reported-failure');
  const t=beginChallenge({handoff:'Goal: ship app\nBlocker: no build archive'}, {dir});
  const reason='Only Build 1 exists at /Users/alice/Workspace/release and key=abcd';
  const done=finishChallenge(t,{result:{status:'failed',summary:'Could not upload',reason,evidence:['Looked in Xcode Archives']},phase:'completed'});
  assert.equal(done.failure.code,'agent_reported_failure');
  assert.equal(done.failure.message,undefined); // reason remains available without duplicating it
  assert.equal(done.reason,reason);
});

test('can recover a crashed attempt with no finish event from the persisted start and stage',()=>{
  const dir=store('crash');
  const token=beginChallenge({handoff:'Goal: Build 9\nBlocker: upload blocked'}, {dir});
  checkpointChallenge(token,'model_startup');
  const rows=listChallenges({dir});
  assert.deepEqual(rows[0].attempts.map(a=>a.event),['started','checkpoint']);
  assert.equal(rows[0].attempts.at(-1).stage,'model_startup');
  checkpointChallenge(token,'model_inference');
  const after=listChallenges({dir})[0];
  assert.equal(after.attempts.length,2);
  assert.equal(after.attempts.at(-1).stage,'model_inference');
  assert.equal(readdirSync(join(dir,token.challengeId)).filter(x=>x.endsWith('.json')).length,3); // challenge, started, single checkpoint
});

test('failure classifier distinguishes known stages and retains full cause chain',()=>{
  assert.equal(failureInfo(new Error('Local inference server startup timed out')).stage,'model_startup');
  assert.equal(failureInfo(new Error('Local agent returned no parseable JSON result')).stage,'result_parsing');
  assert.equal(failureInfo(new Error('Local agent claimed resolved without a successful tool result')).code,'verification_missing');
  assert.equal(failureInfo(new Error('unexpected failure'),'setup').stage,'setup');
  assert.equal(failureInfo(new Error('unexpected failure'),'setup').message,'unexpected failure');
});

test('rejects invalid correlation IDs and nonprivate ledger directories',()=>{
  assert.throws(()=>beginChallenge({handoff:fixture,correlationId:'job/../secret'}, {dir:store('bad-id')}), /Invalid --correlation-id/);
  const publicDir=store('public');
  mkdirSync(publicDir); chmodSync(publicDir,0o755);
  assert.throws(()=>beginChallenge({handoff:fixture}, {dir:publicDir}), /private real directory/);
  assert.throws(()=>challengeDirectory({NEO_ESCALATION_CHALLENGES_DIR:'relative'}),/absolute path/);
  assert.equal(challengeSummary(fixture).blocker,'key=abcd1234 at /Users/alice/.secrets/token.txt');
});

test('CLI creates and completes a real failure ledger before model is started, and links retries',()=>{
  const dir=store('cli-ledger');
  const cases=store('cli-cases');
  const handoffPath=join(root,'handoff.md');
  writeFileSync(handoffPath,fixture,{mode:0o600});
  const env={...process.env,NEO_ESCALATION_CHALLENGES_DIR:dir,
    NEO_ESCALATION_CASES_DIR:cases,NEO_ESCALATION_ENGINE:'definitely_invalid'};
  const args=['escalation','--handoff-file',handoffPath,'--correlation-id','job/demo/task/auth'];
  for (let i=0;i<2;i++) {
    const proc=spawnSync(process.execPath,[cli,...args],{cwd:resolve(cli,'../..'),env,encoding:'utf8'});
    assert.equal(proc.status,1,proc.stderr);
    assert.match(proc.stderr,/NEO_ESCALATION_ENGINE must be/);
    assert.doesNotMatch(proc.stdout + proc.stderr,/abcd1234|example\.test/);
  }
  const rows=listChallenges({dir});
  assert.equal(rows.length,1);
  assert.equal(rows[0].handoff,fixture);
  assert.equal(rows[0].attempts.filter(a=>a.event==='started').length,2);
  const failures=rows[0].attempts.filter(a=>a.event==='finished');
  assert.equal(failures.length,2);
  assert.equal(rows[0].attempts.filter(a=>a.event==='checkpoint').length,0);
  assert.ok(failures.every(a=>a.failure.stage==='preflight'));
  assert.ok(failures.every(a=>a.failure.message.includes('NEO_ESCALATION_ENGINE')));
  const cliRows=JSON.parse(execFileSync(process.execPath,[cli,'escalation','challenges','--limit','5'],
    {env,encoding:'utf8'}));
  assert.equal(cliRows.length,1);
  assert.equal(cliRows[0].handoff,fixture);
});
