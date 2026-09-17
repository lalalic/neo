import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseJsonl, CodexBackend } from '../src/backends/codex.mjs';

test('parses Codex JSONL thread and assistant message events',()=>{
  const parsed=parseJsonl([
    JSON.stringify({type:'thread.started',thread_id:'thread-a'}),
    JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'hello tutor'}}),
    'not json',
  ].join('\n'));
  assert.equal(parsed.threadId,'thread-a');
  assert.equal(parsed.text,'hello tutor');
});

test('persists one thread per child and rollover clears only that child',async()=>{
  const instance=fs.mkdtempSync(path.join(os.tmpdir(),'family-tutor-test-'));
  const backend=new CodexBackend({}, {instanceDir:instance});
  fs.mkdirSync(path.join(instance,'sammy'),{recursive:true});
  fs.mkdirSync(path.join(instance,'config','sammy'),{recursive:true});
  fs.writeFileSync(path.join(instance,'sammy','AGENTS.md'),'real learner memory');
  fs.writeFileSync(path.join(instance,'config','sammy','AGENTS.md'),'wrong config memory');
  assert.equal(backend.memoryFile('sammy'),path.join(instance,'sammy','AGENTS.md'));
  backend.writeThread('sammy','thread-s'); backend.writeThread('maggie','thread-m');
  assert.equal(backend.readThread('sammy'),'thread-s');
  assert.equal(fs.readFileSync(backend.memoryFile('sammy'),'utf8'),'real learner memory');
  await backend.newThread({childId:'sammy'});
  assert.equal(backend.readThread('sammy'),null);
  assert.equal(backend.readThread('maggie'),'thread-m');
  fs.rmSync(instance,{recursive:true,force:true});
});
