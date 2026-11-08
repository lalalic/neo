import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createProjectWithWebHelm, createOrchestratorBootstrap } from '../core/orchestrator.mjs';
import { createChat } from '../core/chat.mjs';
import { openLedger } from '../core/ledger.mjs';
import { files } from '../core/files.mjs';
import { fixture } from './helpers.mjs';

const projectId = 'g-p-12345678901234567890123456789012';
const threadId = 'a2345678-aaaa-bbbb-cccc-ddddeeeeffff';

test('Project bootstrap reuses durable Project/Thread across restarts and serializes concurrent ensure', async (t) => {
  const { dir } = await fixture(t);
  const ledger = await openLedger({ dir });
  const chat = createChat({ ledger, files, dir, submit: async () => {} });
  let calls = 0;
  const init = () => createOrchestratorBootstrap({
    chat,
    readInstructions: async () => 'Chat Gateway orchestrator instructions',
    createProject: async ({ projectName, instructions, initialPrompt }) => {
      calls++;
      assert.equal(projectName, 'orchestrator');
      assert.match(instructions, /orchestrator/);
      assert.match(initialPrompt, /main thread/);
      return { projectId, threadId };
    },
  });
  const boot = init();
  const [a, b] = await Promise.all([boot.ensure(), boot.ensure()]);
  assert.equal(a.state, 'ready');
  assert.equal(b.state, 'ready');
  assert.equal(calls, 1);
  assert.equal((await chat.head()).projectId, projectId);
  assert.equal((await chat.head()).threadId, threadId);
  const restarted = init();
  assert.equal((await restarted.ensure()).state, 'ready');
  assert.equal(calls, 1);

  await chat.bind({ threadId: 'new-head-thread-12345678' });
  assert.equal((await chat.head()).projectId, projectId);
  await restarted.ensure();
  assert.equal(calls, 1);
  assert.equal((await chat.head()).threadId, 'new-head-thread-12345678');
});

test('Project bootstrap retries WebHelm failure without blocking unrelated service features', async (t) => {
  const { dir } = await fixture(t);
  const ledger = await openLedger({ dir });
  const chat = createChat({ ledger, files, dir, submit: async () => {} });
  let calls = 0;
  const bootstrap = createOrchestratorBootstrap({
    chat, readInstructions: async () => 'instructions',
    createProject: async () => {
      if (++calls === 1) throw new Error('WebHelm temporarily unavailable');
      return { projectId, threadId };
    },
  });
  assert.equal((await bootstrap.ensure()).state, 'error');
  assert.equal((await chat.head()).bound, false);
  assert.equal((await bootstrap.ensure()).state, 'ready');
  assert.equal(calls, 2);
});

test('WebHelm adapter verifies real project-setup receipts from a private config file', async (t) => {
  const { dir } = await fixture(t);
  const launcher = join(dir, 'fake-webhelm');
  const script = [
    '#!/usr/bin/env node',
    "const fs=require('fs');",
    "const a=process.argv.slice(2);",
    "if(a.slice(0,4).join(' ')!=='platform run chatgpt project-setup')process.exit(5);",
    "if(!a.includes('--auto-session'))process.exit(6);",
    "const c=JSON.parse(fs.readFileSync(a[a.indexOf('--config')+1],'utf8'));",
    "if(c.project_name!=='orchestrator'||!c.instructions.includes('Test instructions'))process.exit(7);",
    "const r={status:'completed',project_id:'g-p-12345678901234567890123456789012',project_url:'https://chatgpt.com/g/g-p-12345678901234567890123456789012/project',thread_id:'a2345678-aaaa-bbbb-cccc-ddddeeeeffff',thread_url:'https://chatgpt.com/c/a2345678-aaaa-bbbb-cccc-ddddeeeeffff'};",
    "process.stdout.write(JSON.stringify({result:{ok:true,stdout:JSON.stringify(r)}})+'\\n');",
    '',
  ].join('\n');
  await writeFile(launcher, script);
  await chmod(launcher, 0o755);
  const receipt = await createProjectWithWebHelm({
    command: launcher, instructions: 'Test instructions', initialPrompt: 'Start main thread',
  });
  assert.equal(receipt.projectId, projectId);
  assert.equal(receipt.threadId, threadId);
});
