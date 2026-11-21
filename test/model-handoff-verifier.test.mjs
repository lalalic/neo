import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createOrchestratorHandoffVerifier} from '../services/models/handoff-verifier.mjs';

const candidate={
  projectId:'g-p-12345678901234567890123456789012',
  previousThreadId:'orchestrator_previous_12345',
  nextThreadId:'orchestrator_successor_12345',
  expectedGeneration:0,
  handoffReceipt:'receipt_generation_zero_12345',
};
const url=`https://chatgpt.com/g/${candidate.projectId}/c/${candidate.nextThreadId}`;
function fixture({match=true,observedUrl=url,verified=true}={}){
  const seen=[];
  const run=async args=>{
    seen.push(args);
    if(args[1]==='start')return {session_id:'mock-browser-session-123'};
    if(args[1]==='exec'){
      const source=readFileSync(args[4],'utf8');
      assert.match(source,/data-message-author-role/);
      assert.match(source,/previousThreadId/);
      assert.match(source,/expectedGeneration/);
      assert.match(source,/handoffReceipt/);
      assert.match(source,/bg-user-message/);
      assert.match(source,/data-conversation-role/);
      return {ok:true,value:{receiptMatches:match,url:observedUrl}};
    }
    if(args[1]==='stop')return {closed:true};
    throw Error('unexpected browser action');
  };
  const check=[];
  const verifyThread=async identity=>{check.push(identity);if(!verified)throw Error('foreign Project');return true};
  return {run,seen,check,verifyThread};
}

test('independently verify source and successor Project plus successor user-turn receipt',async()=>{
  const {run,seen,check,verifyThread}=fixture();
  const verify=createOrchestratorHandoffVerifier({run,verifyThread});
  assert.equal(await verify(candidate),true);
  assert.deepEqual(check,[{projectId:candidate.projectId,threadId:candidate.previousThreadId},
    {projectId:candidate.projectId,threadId:candidate.nextThreadId}]);
  assert.deepEqual(seen.at(-1),['session','stop','mock-browser-session-123']);
});
test('accepts same-Project canonical URL name suffix with independent user marker',async()=>{
  const observed='https://chatgpt.com/g/'+candidate.projectId+'-project-name/c/'+candidate.nextThreadId;
  const {run,verifyThread}=fixture({observedUrl:observed});
  assert.equal(await createOrchestratorHandoffVerifier({run,verifyThread})(candidate),true);
});
test('a fabricated model receipt cannot pass without matching browser user turn',async()=>{
  const {run,seen,verifyThread}=fixture({match:false});
  await assert.rejects(createOrchestratorHandoffVerifier({run,verifyThread})(candidate),/lacks independently/);
  assert.equal(seen.at(-1)[1],'stop');
});
test('reject wrong-project browser redirects even if marker matches',async()=>{
  const {run,seen,verifyThread}=fixture({observedUrl:`https://chatgpt.com/g/g-p-wrong/c/${candidate.nextThreadId}`});
  await assert.rejects(createOrchestratorHandoffVerifier({run,verifyThread})(candidate),/outside the verified Project/);
  assert.equal(seen.at(-1)[1],'stop');
});
test('bad control metadata and failed predecessor Project verification never open successor session',async()=>{
  const {run,seen,verifyThread}=fixture();
  const verify=createOrchestratorHandoffVerifier({run,verifyThread});
  await assert.rejects(verify({...candidate,handoffReceipt:'short'}),/Invalid Orchestrator/);
  await assert.rejects(verify({...candidate,nextThreadId:candidate.previousThreadId}),/Invalid Orchestrator/);
  assert.equal(seen.length,0);
  const rejected=fixture({verified:false});
  await assert.rejects(createOrchestratorHandoffVerifier(rejected)(candidate),/foreign Project/);
  assert.equal(rejected.seen.length,0);
});
