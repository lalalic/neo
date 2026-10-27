import test from 'node:test';
import assert from 'node:assert/strict';
import { requireConfiguredLearners } from '../skills/family-tutor/runtime/tutor-orchestrator/src/learner-bindings.mjs';

test('two configured learners use their own existing ChatGPT Projects and threads',()=>{
  const children=[{id:'sammy'},{id:'maggie'}];
  const bindings=[
    {learner:'sammy',project_id:'project-a',thread_id:'thread-a'},
    {learner:'maggie',project_id:'project-b',thread_id:'thread-b'}
  ];
  assert.deepEqual(requireConfiguredLearners(children,{bindings}),bindings);
});

test('missing bindings fail closed and never create replacement Projects',()=>{
  assert.throws(()=>requireConfiguredLearners([{id:'sammy'},{id:'maggie'}],{
    bindings:[{learner:'sammy',project_id:'project-a',thread_id:'thread-a'}]
  }),/missing for learner maggie/);
});
