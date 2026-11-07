import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { runEscalationSelfTest } from '../.bin/neo-escalation-self-test.mjs';

const NONCE = '0123456789abcdef0123456789abcdef';
const CFG = {engine:'llama',model:'test-model'};
function fixtureValue(request) {
  const line = request.handoff.split('Use your terminal / Shell tool to read the file at ')[1]?.split('\n')[0];
  const path = line?.endsWith('.') ? line.slice(0, -1) : line;
  assert.ok(path, 'handoff includes fixture path');
  assert.doesNotMatch(request.handoff, new RegExp(NONCE));
  return {path,value:readFileSync(path,'utf8').trim()};
}
function opts(overrides={}) {
  return {agentPrompt:'Local executor rules',random:()=>NONCE,config:CFG,processAlive:()=>false,...overrides};
}
test('requires an agent prompt and strong nonce', async()=>{
  await assert.rejects(runEscalationSelfTest(opts({agentPrompt:''})),/prompt/);
  await assert.rejects(runEscalationSelfTest(opts({random:()=> 'a'})),/nonce/);
});
test('successful proof reads unknown file value, checks PID, and cleans fixture',async()=>{
  let path;
  const result=await runEscalationSelfTest(opts({
    run:async(request,runtime)=>{
      const data=fixtureValue(request);path=data.path;
      assert.match(request.handoff,/Do not contact anyone/);
      assert.match(request.onNeedsUser,/Never notify/);
      runtime.onServerStarted(4321);
      return {status:'resolved',summary:'read',evidence:[data.value]};
    },
  }));
  assert.equal(result.status,'pass');
  assert.equal(result.engine,'llama');
  assert.equal(result.checks.unknown_value_verified,true);
  assert.equal(result.checks.model_process_released,true);
  assert.equal(existsSync(path),false);
});
test('hallucinated success fails and temporary file is removed',async()=>{
  let path;
  await assert.rejects(runEscalationSelfTest(opts({
    run:async(request,runtime)=>{
      path=fixtureValue(request).path;
      runtime.onServerStarted(4321);
      return {status:'resolved',summary:'guessed',evidence:['wrong value']};
    },
  })),/actual file-reading evidence/);
  assert.equal(existsSync(path),false);
});
test('needs_user or failed results never pass',async()=>{
  for(const status of ['needs_user','failed']){
    await assert.rejects(runEscalationSelfTest(opts({
      run:async(request,runtime)=>{
        runtime.onServerStarted(4321);
        return {status,summary:'not working',evidence:[]};
      },
    })),new RegExp(status));
  }
});
test('missing PID and resident model fail closed',async()=>{
  await assert.rejects(runEscalationSelfTest(opts({
    run:async request=>({status:'resolved',summary:'read',evidence:[fixtureValue(request).value]}),
  })),/not observed/);
  await assert.rejects(runEscalationSelfTest(opts({
    processAlive:()=>true,
    run:async(request,runtime)=>{
      runtime.onServerStarted(4321);
      return {status:'resolved',summary:'read',evidence:[fixtureValue(request).value]};
    },
  })),/not released/);
});
test('external model leaves unowned server alone',async()=>{
  const result=await runEscalationSelfTest(opts({
    config:{engine:'external',model:'custom'},
    run:async request=>({status:'resolved',summary:'read',evidence:[fixtureValue(request).value]}),
  }));
  assert.equal(result.checks.model_process_released,null);
});
test('model errors propagate as failures',async()=>{
  await assert.rejects(runEscalationSelfTest(opts({
    run:async()=>{throw new Error('local model connection failed')},
  })),/local model connection failed/);
});
