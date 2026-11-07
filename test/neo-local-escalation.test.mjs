import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync, existsSync } from 'node:fs';
import {
  localEscalationConfig, serverArguments, hermesArguments, parseLocalAnswer, normalizeLocalResult, runLocalEscalation,
} from '../.bin/neo-local-escalation.mjs';

function resultEvents(result, withTool = false) {
  const events = [{type:'system',subtype:'init',session_id:'test'}];
  if (withTool) events.push({type:'tool_use',name:'terminal',input:{command:'pwd'}}, {type:'tool_result',name:'terminal',is_error:false,output:'/tmp'});
  events.push({type:'result',exit_code:0,text:JSON.stringify(result),session_id:'test'});
  return events.map(event=>JSON.stringify(event)).join('\n');
}

const LOCAL = { engine:'llama', model:'unsloth/Qwen3.5-4B-GGUF:Q4_K_M', context:65536, budgetSeconds:300, maxTurns:8, startupMs:2000, serverCommand:'llama-server', hermesCommand:'hermes' };

test('defaults to Apple Metal-friendly Qwen3.5-4B llama and supports model/engine override',()=>{
  const d = localEscalationConfig({});
  assert.equal(d.engine,'llama');
  assert.match(d.model,/4B.*Q4_K_M/);
  assert.equal(d.context,65536);
  assert.equal(localEscalationConfig({NEO_ESCALATION_ENGINE:'mlx'}).model,'mlx-community/Qwen3.5-4B-MLX-4bit');
  assert.equal(localEscalationConfig({NEO_ESCALATION_ENGINE:'llama',NEO_ESCALATION_MODEL:'/tmp/test.gguf'}).model,'/tmp/test.gguf');
  assert.equal(localEscalationConfig({NEO_ESCALATION_ENGINE:'external',NEO_ESCALATION_BASE_URL:'http://127.0.0.1:7000/v1'}).engine,'external');
});

test('invalid config and remote endpoints fail before any model starts',()=>{
  for(const env of [{NEO_ESCALATION_ENGINE:'cloud'}, {NEO_ESCALATION_CONTEXT:'4096'}, {NEO_ESCALATION_CONTEXT:'NaN'}, {NEO_ESCALATION_MAX_TURNS:'0'}, {NEO_ESCALATION_BUDGET_SECONDS:'999999'}, {NEO_ESCALATION_ENGINE:'external',NEO_ESCALATION_BASE_URL:'https://example.com/v1'}]) {
    assert.throws(()=>localEscalationConfig(env));
  }
});

test('inference server is local, Metal offload, quantized cache, single slot',()=>{
  const args=serverArguments(LOCAL,18937);
  assert.deepEqual(args.slice(0,2), ['--hf-repo',LOCAL.model]);
  assert.ok(args.includes('--no-mmproj'));
  assert.ok(args.includes('--jinja'));
  assert.equal(args[args.indexOf('--host')+1],'127.0.0.1');
  assert.equal(args[args.indexOf('--port')+1],'18937');
  assert.equal(args[args.indexOf('-c')+1],'65536');
  assert.equal(args[args.indexOf('-np')+1],'1');
  assert.equal(args[args.indexOf('-ngl')+1],'99');
  assert.equal(args[args.indexOf('-ctk')+1],'q8_0');
  assert.equal(args[args.indexOf('-ctv')+1],'q8_0');
  assert.deepEqual(serverArguments({...LOCAL,model:'/tmp/a.gguf'}, 3333).slice(0,2), ['-m','/tmp/a.gguf']);
  assert.deepEqual(serverArguments({...LOCAL,engine:'mlx',model:'model/x'}, 3333).slice(0,2),['--model','model/x']);
  assert.throws(()=>serverArguments({...LOCAL,engine:'external'},3333),/External/);
});

test('Hermes one-shot receives only local custom endpoint and toolsets',()=>{
  const args=hermesArguments('/tmp/test/handoff.md',LOCAL,'http://127.0.0.1:18937/v1','/tmp/test');
  assert.ok(args.includes('--oneshot'));
  assert.equal(args[args.indexOf('--query-file')+1],'/tmp/test/handoff.md');
  assert.equal(args[args.indexOf('--provider')+1],'custom');
  assert.equal(args[args.indexOf('--base-url')+1],'http://127.0.0.1:18937/v1');
  assert.equal(args[args.indexOf('--model')+1],'neo-escalation');
  assert.equal(args[args.indexOf('--toolsets')+1],'terminal,skills');
  assert.equal(args[args.indexOf('--skills')+1],'webhelm');
  assert.ok(args.includes('--yolo'));
  assert.ok(!args.includes('--ignore-user-config'));
  assert.ok(!args.includes('--run-budget'));
  assert.equal(args[args.indexOf('--format')+1],'stream-json');
});

test('parse final JSON or fenced response; refuse raw text',()=>{
  const out={status:'resolved',summary:'done',reason:null,user_action:null,evidence:['verified'],notification:null};
  assert.deepEqual(parseLocalAnswer(resultEvents(out,true)),out);
  assert.throws(()=>parseLocalAnswer(resultEvents(out,false)),/without a successful tool result/);
  assert.throws(()=>parseLocalAnswer('done'),/non-JSON event/);
});

test('local model output is normalized to the exact escalation result schema',()=>{
  const normalized=normalizeLocalResult({status:'resolved',summary:'file verified',reason:'observed',evidence:{nonce:'abc123',path:'/tmp/data'},notification:null});
  assert.deepEqual(normalized.evidence,['nonce: abc123','path: /tmp/data']);
  assert.deepEqual(Object.keys(normalized),['status','summary','reason','user_action','evidence','notification']);
  assert.equal(normalized.user_action,null);
  assert.throws(()=>normalizeLocalResult({status:'resolved',summary:'done',evidence:[]}),/no evidence/);
  assert.throws(()=>normalizeLocalResult({status:'needs_user',summary:'OTP missing',evidence:[]}),/user action/);
  assert.throws(()=>normalizeLocalResult({status:'resolved',summary:'done',evidence:['e'],notification:{attempted:true,delivered:'yes'}}),/notification/);
});

test('owned local model starts, runs Hermes, then stops and deletes sensitive scratch files',async()=>{
  let commandArgs, agentArgs, temp, server;
  const child=new EventEmitter(); child.exitCode=null;child.signalCode=null;
  child.kill=()=>{child.exitCode=0;child.emit('close',0); return true;};
  const result=await runLocalEscalation({handoff:'Verify local status',cwd:'/tmp/project',onNeedsUser:'File Helper first'},{
    config:LOCAL, agentPrompt:'Local escalation system rules',
    portFactory:async()=>18937,
    spawnServer:(command,args, opts)=>{server=child;commandArgs={command,args,opts};return child;},
    fetcher:async()=>Response.json({status:'ok'}),
    runAgent:async(command,args,opts)=>{
      agentArgs={command,args,opts};
      temp=opts.cwd;
      assert.match(readFileSync(temp+'/AGENTS.md','utf8'),/Local escalation system rules/);
      assert.match(readFileSync(temp+'/handoff.md','utf8'),/Verify local status/);
      assert.match(readFileSync(temp+'/handoff.md','utf8'),/File Helper first/);
      assert.match(readFileSync(temp+'/handoff.md','utf8'),/\/tmp\/project/);
      return resultEvents({status:'resolved',summary:'verified',reason:null,user_action:null,evidence:['mock observation'],notification:null},true);
    },
  });
  assert.equal(result.status,'resolved');
  assert.equal(commandArgs.command,'llama-server');
  assert.equal(agentArgs.command,'hermes');
  assert.equal(server.exitCode,0);
  assert.equal(existsSync(temp),false);
});

test('external endpoint calls Agent but never starts a model server',async()=>{
  let agentCalled=false;
  const res=await runLocalEscalation({handoff:'Read status',cwd:'/tmp',onNeedsUser:'none'},{
    agentPrompt:'Rules',
    config:{...LOCAL,engine:'external',baseUrl:'http://127.0.0.1:7777/v1'},
    spawnServer:()=>{throw new Error('must not run')},
    runAgent:async()=>{agentCalled=true;return resultEvents({status:'failed',summary:'not found',reason:'mock',user_action:null,evidence:[],notification:null});},
  });
  assert.equal(res.status,'failed');
  assert.ok(agentCalled);
});

test('agent failure stops owned model and cleans temp directory',async()=>{
  let server,temp;
  const child=new EventEmitter();child.exitCode=null;child.signalCode=null;
  child.kill=()=>{child.exitCode=0;child.emit('close',0);return true;};
  await assert.rejects(runLocalEscalation({handoff:'Task',cwd:'/tmp',onNeedsUser:'none'},{
    config:LOCAL,agentPrompt:'Rules',
    portFactory:async()=>18937,
    spawnServer:()=>{server=child;return child;},
    fetcher:async()=>Response.json({status:'ok'}),
    runAgent:async(cmd,args,opts)=>{temp=opts.cwd;throw new Error('agent failure');},
  }),/agent failure/);
  assert.equal(server.exitCode,0);
  assert.equal(existsSync(temp),false);
});
