import test from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync, mkdtempSync, mkdirSync, readFileSync, symlinkSync,
  readdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  prepareEphemeralHermesHome, redactEscalationResult, runLocalEscalation,
} from '../.bin/neo-local-escalation.mjs';

function withTemp(fn) {
  const folder=mkdtempSync(join(tmpdir(), 'neo-credential-test-'));
  try { return fn(folder); } finally { rmSync(folder,{recursive:true,force:true}); }
}

test('Local Agent prompt grants scoped repeat plaintext use without returning credentials',()=>{
  const prompt=readFileSync(new URL('../agents/escalation.agent.md',import.meta.url),'utf8');
  const playbook=readFileSync(new URL('../agents/neo-escalation-playbook.md',import.meta.url),'utf8');
  assert.match(prompt,/plaintext API keys and tokens/);
  assert.match(prompt,/as many times as authorized work requires/);
  assert.match(prompt,/Never include any plaintext key or token in the final JSON/);
  assert.match(prompt,/Do not retain an agent session\/thread/);
  assert.match(prompt,/USD 10 preapproved cumulative limit/);
  assert.match(playbook,/GitHub/);
  assert.match(playbook,/npm registry/i);
  assert.match(playbook,/Cloudflare/);
  assert.match(playbook,/no per-use limit/);
});

test('ephemeral Hermes home borrows dependencies and WebHelm without session persistence',()=>{
  withTemp(folder=>{
    const home=join(folder,'home');
    const temp=join(folder,'work');
    mkdirSync(join(home,'.hermes/installs'),{recursive:true});
    mkdirSync(join(home,'.hermes/tools'),{recursive:true});
    mkdirSync(join(home,'.agents/skills/webhelm'),{recursive:true});
    mkdirSync(temp);
    const hermesHome=prepareEphemeralHermesHome(temp,{home});
    assert.equal(existsSync(join(hermesHome,'installs')),true);
    assert.equal(existsSync(join(hermesHome,'tools')),true);
    assert.equal(existsSync(join(hermesHome,'skills/webhelm')),true);
    assert.equal(existsSync(join(home,'.hermes/sessions')),false);
    assert.equal(existsSync(join(hermesHome,'sessions')),false);
  });
});

test('public return masks keys, opaque output, and tool-observed short credential',()=>{
  const secret='abcdef123';
  const key='sk-test-7PlngQk921_SecretToken';
  const result={
    status:'resolved',
    summary:`stored API_KEY=${key}`,
    reason:`token: ${secret}`,
    user_action:`copy ${secret}`,
    evidence:[`key is ${key}`, `received ${secret}`, 'Cloudflare binding verified'],
    notification:{attempted:true,delivered:true,channel:'wechat-bro',details:`Authorization: Bearer ${key}`},
  };
  const events=[{type:'tool_result',name:'terminal',output:secret,is_error:false}];
  const safe=redactEscalationResult(result,events);
  const out=JSON.stringify(safe);
  assert.equal(safe.status,'resolved');
  assert.ok(out.includes('Cloudflare binding verified'));
  assert.ok(!out.includes(key));
  assert.ok(!out.includes(secret));
  assert.match(out,/REDACTED/);
});

test('agent temporary session records are deleted even when task fails', async()=>{
  const base=mkdtempSync(join(tmpdir(), 'neo-credential-isolation-'));
  try {
    let sessionPath;
    const result=await runLocalEscalation({handoff:'Inspect mock credential source',cwd:base,onNeedsUser:'Do not notify'},{
      config:{engine:'external',model:'test',baseUrl:'http://127.0.0.1:12070/v1',budgetSeconds:25,maxTurns:3,hermesCommand:'mock'},
      agentPrompt:'Test agent',
      runAgent:async (command,args,{env})=>{
        assert.ok(env.HERMES_HOME.includes('neo-local-escalation-'));
        assert.ok(existsSync(join(env.HERMES_HOME,'installs')));
        sessionPath=join(env.HERMES_HOME,'sessions/thread.json');
        mkdirSync(join(env.HERMES_HOME,'sessions'),{recursive:true});
        writeFileSync(sessionPath,'mock plaintext from ephemeral tool chat');
        return [
          JSON.stringify({type:'tool_use',name:'terminal',input:{command:'echo verified'}}),
          JSON.stringify({type:'tool_result',name:'terminal',is_error:false,output:'verified'}),
          JSON.stringify({type:'result',exit_code:0,text:JSON.stringify({
            status:'resolved',summary:'verification passed',reason:null,user_action:null,evidence:['verified'],notification:null,
          })}),
        ].join('\n');
      },
    });
    assert.equal(result.status,'resolved');
    assert.equal(existsSync(sessionPath),false);
  } finally { rmSync(base,{recursive:true,force:true}); }
});

test('experience memory stores scenario metadata but never a session transcript or tool output',async()=>{
  const {prepareExperience} = await import('../.bin/neo-escalation-experience.mjs');
  const candidate = prepareExperience({
    handoff:'Mock credential provisioning',
    result:{status:'resolved',summary:'verified'},
    experience:{scenario_key:'credential.mock_source',strategy_key:'shell.private_transfer',
      category:'authentication',steps:['Checked existing source','Configured target'],
      symptom:'Key missing on first source',verification:'Target validation passed'},
    events:[{type:'tool_use',name:'terminal',input:{command:'cat approved-fixture'}},
      {type:'tool_result',name:'terminal',is_error:false,output:'sk-test-private-value-12345678'}],
  });
  const encoded=JSON.stringify(candidate);
  assert.equal(Object.hasOwn(candidate,'raw'),false);
  assert.ok(!encoded.includes('sk-test-private-value-12345678'));
  assert.ok(encoded.includes('credential.mock_source'));
  assert.equal(candidate.observation.calls,1);
});
