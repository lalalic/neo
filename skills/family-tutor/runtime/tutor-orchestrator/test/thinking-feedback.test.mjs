import test from 'node:test';
import assert from 'node:assert/strict';
import { beginThinkingFeedback, thinkingFeedbackReaction } from '../src/thinking-feedback.mjs';

function message(id='message-1'){
  const calls=[];
  const reaction={remove:async()=>calls.push('reaction removed')};
  return {id,channelId:'channel-1',calls,
    react:async(value)=>{calls.push(['react',value]); return reaction;},
    reply:async()=>{throw new Error('thinking feedback must not post a reply');}};
}

test('shows one transient reaction per Discord message, then clears it',async()=>{
  const original=message();
  const first=await beginThinkingFeedback(original);
  const second=await beginThinkingFeedback(original);
  assert.equal(first,second);
  assert.deepEqual(original.calls,[['react',thinkingFeedbackReaction]]);
  await first.clear();
  assert.deepEqual(original.calls,[['react',thinkingFeedbackReaction],'reaction removed']);
  await second.clear();
  assert.equal(original.calls.length,2);
});

test('does not share duplicate state between Discord messages',async()=>{
  const first=message('message-a');
  const second=message('message-b');
  await beginThinkingFeedback(first);
  await beginThinkingFeedback(second);
  assert.equal(first.calls.filter(call=>Array.isArray(call)&&call[0]==='react').length,1);
  assert.equal(second.calls.filter(call=>Array.isArray(call)&&call[0]==='react').length,1);
});
