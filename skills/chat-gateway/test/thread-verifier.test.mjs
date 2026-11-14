import test from 'node:test';
import assert from 'node:assert/strict';
import {createThreadProjectVerifier} from '../core/thread-verifier.mjs';
import {createChat} from '../core/chat.mjs';
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

test('rejects wrong project, spoofed slug, missing conversation and foreign origin with cleanup',async()=>{
  for(const [url,opts] of [
    [`https://chatgpt.com/g/g-p-otherproject123/c/${threadId}`,{}],
    [`https://chatgpt.com/g/${projectId}imposter/c/${threadId}`,{}],
    [`https://chatgpt.com/g/${projectId}-slug/c/${threadId}`,{}],
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

test('bind never overwrites the last known good head when verification fails',async t=>{
  const {dir,ledger}=await fixture(t);
  const attempts=[];
  const chat=createChat({dir,ledger,files,submit:async()=>{},verifyProjectThread:async identity=>{
    attempts.push(identity);
    throw Error('unverified foreign thread');
  }});
  await assert.rejects(chat.bind({threadId}),/initialized orchestrator Project/);
  await chat.bindSystem({projectId,threadId});
  assert.deepEqual(await chat.bind({threadId}),{bound:true,threadId});
  await assert.rejects(chat.bind({threadId:'another-thread-12345678',previousThreadId:threadId}),/unverified foreign thread/);
  assert.equal((await chat.head()).threadId,threadId);
  assert.deepEqual(attempts,[{projectId,threadId:'another-thread-12345678'}]);
  const restarted=createChat({dir,ledger,files,submit:async()=>{}});
  assert.equal((await restarted.head()).threadId,threadId);
});


test('competing successor handoffs cannot use a stale previous head', async t => {
  const {dir,ledger}=await fixture(t);
  const chat=createChat({dir,ledger,files,submit:async()=>{},verifyProjectThread:async()=>true});
  await chat.bindSystem({projectId,threadId});
  const first='new-head-abcdefgh1234567';
  const second='new-head-zyxwvuts1234567';
  const results=await Promise.allSettled([
    chat.bind({threadId:first,previousThreadId:threadId}),
    chat.bind({threadId:second,previousThreadId:threadId}),
  ]);
  assert.equal(results[0].status,'fulfilled');
  assert.equal(results[1].status,'rejected');
  assert.match(results[1].reason.message,/previous head thread ID/);
  assert.equal((await chat.head()).threadId,first);
  await assert.rejects(chat.bind({threadId:second}),/previous head thread ID/);
});


test('a stale browser verifier cannot overwrite a head changed during its check', async t => {
  const {dir,ledger}=await fixture(t);
  const other='external-head-abcdefgh123';
  const chat=createChat({dir,ledger,files,submit:async()=>{},verifyProjectThread:async()=>{
    await files.writeJsonAtomic(`${dir}/head.json`,{projectId,threadId:other,since:new Date().toISOString()});
    return true;
  }});
  await chat.bindSystem({projectId,threadId});
  await assert.rejects(chat.bind({threadId:'proposed-head-12345678',previousThreadId:threadId}),/head changed during validation/);
  assert.equal((await chat.head()).threadId,other);
});
