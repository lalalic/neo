import test from 'node:test';
import assert from 'node:assert/strict';
import {createThreadProjectVerifier} from '../core/thread-verifier.mjs';
import {openLedger} from '../core/ledger.mjs';
import {files} from '../core/files.mjs';
import {fixture} from './helpers.mjs';

const projectId='g-p-abcdefghijkl';
const threadId='orchestrator-thread-12345678';
function fakeBrowser(url, {conversation=true,error=false}={}) {
  const calls=[];
  const run=async args => {
    calls.push(args);
    if(args[1]==='start') return {session_id:'abcde123456'};
    if(args[1]==='exec') return {ok:true,value:{url,conversation,error}};
    if(args[1]==='stop') return {closed:true};
    throw Error('unsupported command');
  };
  return {calls,run};
}

test('read-only head validation accepts only a loaded thread in the exact orchestrator Project',async()=>{
  const {calls,run}=fakeBrowser(`https://chatgpt.com/g/${projectId}/c/${threadId}`);
  const verify=createThreadProjectVerifier({run});
  assert.equal(await verify({projectId,threadId}),true);
  assert.deepEqual(calls[0],['session','start','--url',`https://chatgpt.com/c/${threadId}`]);
  assert.deepEqual(calls.at(-1),['session','stop','abcde123456']);
  assert.equal(calls[1][0],'session');
  assert.equal(calls[1][1],'exec');
});

test('accepts real canonical Project URL with a provider name suffix',async()=>{
  const {run}=fakeBrowser('https://chatgpt.com/g/'+projectId+'-project-name/c/'+threadId);
  assert.equal(await createThreadProjectVerifier({run})({projectId,threadId}),true);
});
test('rejects wrong project, spoofed slug, missing conversation and foreign origin with cleanup',async()=>{
  for(const [url,opts] of [
    [`https://chatgpt.com/g/g-p-otherproject123/c/${threadId}`,{}],
    [`https://chatgpt.com/g/${projectId}imposter/c/${threadId}`,{}],
    [`https://other.example/g/${projectId}/c/${threadId}`,{}],
    [`https://chatgpt.com/g/${projectId}/c/wrong-thread-12345`,{}],
    [`https://chatgpt.com/g/${projectId}/c/${threadId}`,{conversation:false}],
    [`https://chatgpt.com/g/${projectId}/c/${threadId}`,{error:true}],
  ]){
    const {run,calls}=fakeBrowser(url,opts);
    await assert.rejects(createThreadProjectVerifier({run})({projectId,threadId}),/not in the bound|not loaded/);
    assert.equal(calls.at(-1)[1],'stop');
  }
});
