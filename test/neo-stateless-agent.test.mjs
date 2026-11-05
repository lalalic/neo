import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runStatelessAgent,executeStatelessTool } from '../.bin/neo-stateless-agent.mjs';
import { parseLocalSession, redactEscalationResult, normalizeLocalResult } from '../.bin/neo-local-escalation.mjs';

const cfg={maxTurns:5,budgetSeconds:30};
const request={cwd:tmpdir(),handoff:'Find a mock API key and configure the mock target without disclosing it',onNeedsUser:'Do not notify'};
const result={status:'resolved',summary:'Mock target configured',reason:null,user_action:null,evidence:['mock target validated'],notification:null};
const response=message=>Response.json({choices:[{message}]});

test('stateless agent invokes local tools and keeps all messages in memory only',async()=>{
  let seen=[];
  let calls=0;
  const stdout=await runStatelessAgent({
    baseUrl:'http://127.0.0.1:12121/v1', agentPrompt:'Local rules',request,config:cfg,
    askModel:async(url,init)=>{
      assert.equal(url,'http://127.0.0.1:12121/v1/chat/completions');
      const body=JSON.parse(init.body);
      seen.push(body);
      if(calls++===0) return response({role:'assistant',content:null,tool_calls:[
        {id:'c1',type:'function',function:{name:'shell',arguments:JSON.stringify({command:'mock-source-read'})}},
      ]});
      return response({role:'assistant',content:JSON.stringify(result)});
    },
    callTool:async(name,args)=>{
      assert.equal(name,'shell');assert.equal(args.command,'mock-source-read');
      return {ok:true,text:'mock-secret: a-short-secret-value'};
    },
  });
  const session=parseLocalSession(stdout);
  assert.equal(session.result.status,'resolved');
  assert.equal(session.events.filter(event=>event.type==='tool_use').length,1);
  assert.equal(session.events.filter(event=>event.type==='tool_result').length,1);
  assert.equal(seen.length,2);
  assert.equal(seen[0].messages[0].role,'system');
  assert.equal(seen[1].messages.at(-2).role,'tool');
  assert.ok(seen[1].messages.at(-2).content.includes('a-short-secret-value'));
  assert.equal(seen[0].messages[1].content.includes('Local rules'),false);
});

test('final answer can be deterministically scrubbed even when model echoes an observed short secret',async()=>{
  const shortSecret='SHORT9Q';
  const final={...result,summary:'returned '+shortSecret,evidence:['saw '+shortSecret]};
  const stdout=await runStatelessAgent({
    baseUrl:'http://127.0.0.1:12121/v1',agentPrompt:'Rules',request,config:cfg,
    askModel:async(url,init)=>{
      const messages=JSON.parse(init.body).messages;
      if(!messages.some(m=>m.role==='tool')) return response({content:null,tool_calls:[
        {id:'c1',type:'function',function:{name:'shell',arguments:'{"command":"cat dummy"}'}},
      ]});
      return response({content:JSON.stringify(final)});
    },
    callTool:async()=>({ok:true,text:shortSecret}),
  });
  const session=parseLocalSession(stdout);
  const safe=redactEscalationResult(normalizeLocalResult(session.result),session.events);
  assert.equal(safe.status,'resolved');
  assert.ok(!JSON.stringify(safe).includes(shortSecret));
});

test('stateless agent refuses non-loopback endpoints and prevents unavailable tool actions',async()=>{
  await assert.rejects(runStatelessAgent({
    baseUrl:'https://example.com/v1',agentPrompt:'Rules',request,config:cfg,
  }),/loopback/);
  await assert.rejects(executeStatelessTool('computer_use',{command:'mcp_arbitrary',args:{}},{cwd:tmpdir()}),/Unapproved/);
  await assert.rejects(executeStatelessTool('webhelm',{args:'session list'},{cwd:tmpdir()}),/Invalid/);
});

test('Shell tool returns observed output and performs no transcript write',async()=>{
  const t=mkdtempSync(join(tmpdir(),'neo-shell-tool-test-'));
  try{
    const output=await executeStatelessTool('shell',{command:'printf local-ok'},{cwd:t});
    assert.equal(output.ok,true);
    assert.equal(output.text,'local-ok');
    assert.deepEqual(readdirSync(t),[]);
  }finally{rmSync(t,{recursive:true,force:true});}
});

test('decision gate continues incomplete authorized work and restores tools next turn',async()=>{
  let modelCalls=0;
  const modes=[];
  const output=await runStatelessAgent({
    baseUrl:'http://127.0.0.1:12121/v1',agentPrompt:'Rules',request,config:cfg,
    askModel:async(url,init)=>{
      const body=JSON.parse(init.body);modes.push(body.tool_choice);
      const step=modelCalls++;
      if(step===0 || step===2) return response({content:null,tool_calls:[
        {id:'step'+step,type:'function',function:{name:'shell',arguments:JSON.stringify({command:'check-step-'+step})}},
      ]});
      if(step===1) return response({content:'{"continue":true,"reason":"perform target verification next"}'});
      return response({content:JSON.stringify(result)});
    },
    callTool:async()=>({ok:true,text:'step checked'}),
  });
  const session=parseLocalSession(output);
  assert.equal(session.result.status,'resolved');
  assert.equal(session.events.filter(e=>e.type==='tool_use').length,2);
  assert.deepEqual(modes,['auto','none','auto','none']);
});

test('invalid decision objects cannot become terminal outcomes and must resume tool access',async()=>{
  let n=0;
  const output=await runStatelessAgent({
    baseUrl:'http://127.0.0.1:12121/v1',agentPrompt:'Rules',request,config:cfg,
    askModel:async()=>{
      const step=n++;
      if(step===0||step===2) return response({content:null,tool_calls:[{
        id:'step-'+step,type:'function',function:{name:'shell',arguments:'{"command":"pwd"}'},
      }]});
      if(step===1) return response({content:'{"done":false,"detail":"work remains"}'});
      return response({content:JSON.stringify(result)});
    },
    callTool:async()=>({ok:true,text:'verified'}),
  });
  const s=parseLocalSession(output);
  assert.equal(s.result.status,'resolved');
  assert.equal(s.events.filter(e=>e.type==='tool_use').length,2);
  assert.equal(n,4);
});
