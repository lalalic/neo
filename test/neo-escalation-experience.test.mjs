import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  categoryKey, sanitizeLesson, prepareExperience,
  storeExperience, listExperience, experienceDirectory,
} from '../.bin/neo-escalation-experience.mjs';

const agent = {
  scenario_key: 'oauth.callback_pending',
  category: 'authentication',
  symptom: 'Authorization callback not received',
  strategy_key: 'webhelm.resume_auth',
  steps: ['Check the existing managed Chrome tab', 'Finish the authorized consent flow'],
  verification: 'Connection status is healthy',
  failure_reason: null,
  lesson: 'Keep the waiting CLI process alive during consent',
};
const temp = mkdtempSync(join(tmpdir(), 'neo-escalation-experience-tests-'));
process.on('exit', () => rmSync(temp, {recursive:true, force:true}));
const sample = (overrides = {}) => prepareExperience({
  handoff: 'OAuth authorization callback appears stuck',
  result: {status:'resolved'},
  experience:agent,
  backend:'local',engine:'llama',model:'unsloth/Qwen3.5-4B-GGUF:Q4_K_M',
  events:[
    {type:'tool_use',name:'terminal',input:{command:'webhelm status --url https://secret.example/session?token=ABC'}},
    {type:'tool_result',name:'terminal',is_error:false,output:'session TOKEN=abc'},
    {type:'tool_use',name:'terminal',input:{command:'neo computer-use call list_apps'}},
  ],
  ...overrides,
});

test('agent-generated scenario, actual tools, result and lessons are captured without raw tool I/O',()=>{
  const r = sample();
  assert.equal(r.source,'agent');
  assert.equal(r.scenario.key,'oauth.callback_pending');
  assert.equal(r.strategy.key,'webhelm.resume_auth');
  assert.equal(r.outcome,'resolved');
  assert.deepEqual(r.observation.tools,['computer-use','shell','webhelm']);
  assert.equal(r.observation.calls,2);
  assert.equal(r.observation.failures,0);
  assert.equal(r.training_reviewed,false);
  assert.equal(r.strategy.lesson,agent.lesson);
  assert.doesNotMatch(JSON.stringify(r), /secret\.example|TOKEN=abc|--url/);
});

test('sensitive values are generalized rather than stored in candidate lessons',()=>{
  const input = 'token=abcd1234 sk-abcdef1234567890 Bearer abc.def.ghi email alice@example.com link https://site.test/auth?key=xyz path /Users/alice/private/token.txt 192.168.1.5';
  const sanitized = sanitizeLesson(input,500);
  assert.match(sanitized,/\[credential\]/);
  assert.match(sanitized,/\[email\]/);
  assert.match(sanitized,/\[url\]/);
  assert.match(sanitized,/\[path\]/);
  assert.match(sanitized,/\[ip\]/);
  assert.match(sanitizeLesson('OTP 123456, verification-code=876543'), /\[one-time-code\]/);
  for(const secret of ['abcd1234','abcdef1234567890','alice@example.com','site.test','/Users/alice','192.168.1.5']) {
    assert.ok(!sanitized.includes(secret), 'leaked ' + secret);
  }
});

test('classification fields reject long secret-like keys and use handoff digest fallback',()=>{
  assert.equal(categoryKey('OAuth Callback Pending'),'oauth_callback_pending');
  assert.equal(categoryKey('oauth.password_prompt'),'oauth.password_prompt');
  assert.equal(categoryKey('oauth.alice@example.com'),'unknown');
  assert.equal(categoryKey('sk-abcdef123456789012345678901234'), 'unknown');
  const fallback = sample({experience:{scenario_key:'',strategy_key:'',steps:[]}});
  assert.match(fallback.scenario.key,/^unclassified\.[a-f0-9]{16}$/);
  assert.equal(fallback.strategy.key,'unclassified');
  assert.equal(fallback.source,'fallback');
  assert.doesNotMatch(JSON.stringify(fallback),/OAuth authorization callback appears stuck/);
});

test('same scenario+outcome+strategy is written once even with varying observations',()=>{
  const dir = join(temp,'dup-cases');
  const a=sample();
  const first=storeExperience(a,{dir});
  const repeat=storeExperience(sample({experience:{...agent,lesson:'Different wording, same strategy'}}),{dir});
  assert.equal(first.stored,true);
  assert.equal(repeat.duplicate,true);
  assert.equal(readdirSync(dir).filter(name=>name.endsWith('.json')).length,1);
  const data=JSON.parse(readFileSync(join(dir,a.id+'.json'),'utf8'));
  assert.equal(data.strategy.lesson,agent.lesson);
  assert.equal(statSync(dir).mode & 0o777,0o700);
  assert.equal(statSync(join(dir,a.id+'.json')).mode & 0o777,0o600);
});

test('failed, resolved, and needs_user experiences are all kept separately',()=>{
  const dir=join(temp,'outcomes');
  const a=sample();
  const failed=sample({
    result:{status:'failed'},
    experience:{...agent,failure_reason:'No callback observed',verification:'Not verified'},
  });
  const human=sample({
    result:{status:'needs_user'},
    experience:{...agent,strategy_key:'human.ask_for_otp',failure_reason:'OTP required'},
  });
  assert.notEqual(a.id,failed.id);
  assert.notEqual(a.id,human.id);
  for(const r of [a,failed,human]) assert.equal(storeExperience(r,{dir}).stored,true);
  assert.equal(storeExperience(failed,{dir}).duplicate,true);
  const rows=listExperience({dir,limit:30});
  assert.deepEqual(rows.map(row=>row.outcome).sort(),['failed','needs_user','resolved']);
  assert.equal(listExperience({dir,search:'callback',limit:30}).length,3);
  assert.equal(listExperience({dir,search:'No callback',limit:30}).length,1);
});

test('runtime or invalid JSON output is saved as a minimal failed case, not a fabricated solution',()=>{
  const err = new Error('secret=supersecret custom failure');
  const r=sample({result:{status:'failed'},experience:undefined,events:[],error:err});
  assert.equal(r.outcome,'failed');
  assert.equal(r.source,'fallback');
  assert.equal(r.strategy.steps.length,0);
  assert.match(r.strategy.key,/runtime\.error/);
  assert.doesNotMatch(JSON.stringify(r),/supersecret/);
  const dir=join(temp,'failures');
  assert.equal(storeExperience(r,{dir}).stored,true);
});

test('only supported status, absolute private directories, and limit are accepted',()=>{
  assert.throws(()=>sample({result:{status:'not_really'}}),/outcome/);
  assert.throws(()=>experienceDirectory({NEO_ESCALATION_CASES_DIR:'./relative'}),/absolute/);
  assert.throws(()=>listExperience({limit:1000}),/limit/);
  assert.deepEqual(listExperience({dir:join(temp,'absent')}),[]);
});

test('concurrent same-case writes are atomic and do not create duplicates',async()=>{
  const dir=join(temp,'concurrent');
  const r=sample();
  const results=await Promise.all(Array.from({length:12},()=>Promise.resolve().then(()=>storeExperience(r,{dir}))));
  assert.equal(results.filter(x=>x.stored).length,1);
  assert.equal(results.filter(x=>x.duplicate).length,11);
  assert.equal(readdirSync(dir).filter(name=>name.endsWith('.json')).length,1);
});

test('local runtime collects model-written experience while returning only the public result', async()=>{
  const { runLocalEscalation } = await import('../.bin/neo-local-escalation.mjs');
  const experience={...agent};
  const answer={status:'resolved',summary:'checked',reason:null,user_action:null,evidence:['actual observation'],notification:null,experience};
  const events=[{type:'tool_use',name:'terminal',input:{command:'pwd'}},{type:'tool_result',name:'terminal',is_error:false},{type:'result',exit_code:0,text:JSON.stringify(answer)}];
  let captured;
  const result=await runLocalEscalation({handoff:'Test',cwd:'/tmp',onNeedsUser:'Do not notify'}, {
    agentPrompt:'base rules',experiencePrompt:'save one experience candidate',
    config:{engine:'external',model:'local',context:65536,maxTurns:4,budgetSeconds:20,baseUrl:'http://127.0.0.1:17011/v1',hermesCommand:'hermes'},
    runAgent:async(cmd,args,opts)=>{
      assert.equal(readFileSync(join(opts.cwd,'AGENTS.md'),'utf8'),'base rules');
      return events.map(event=>JSON.stringify(event)).join('\n');
    },
    onExperience: payload=>{captured=payload;},
  });
  assert.equal(result.status,'resolved');
  assert.equal(Object.hasOwn(result,'experience'),false);
  assert.equal(captured.experience.scenario_key,agent.scenario_key);
  assert.equal(captured.captureMethod,'executor');
  assert.ok(captured.events.some(event=>event.type==='tool_use'));
});

test('postrun local model generates a reusable case without loading extra model or changing public result', async()=>{
  const { runLocalEscalation }=await import('../.bin/neo-local-escalation.mjs');
  let capture; let posted;
  const outcome={status:'failed',summary:'Consent callback not found',reason:'timeout',user_action:null,evidence:['observed timeout'],notification:null};
  const events=[{type:'tool_use',name:'terminal',input:{command:'webhelm status'}},{type:'tool_result',name:'terminal',is_error:true},{type:'result',exit_code:0,text:JSON.stringify(outcome)}];
  const result=await runLocalEscalation({handoff:'OAuth callback missing at https://sensitive.example/private',cwd:'/tmp',onNeedsUser:'none'},{
    config:{engine:'external',model:'model',context:65536,maxTurns:3,budgetSeconds:15,baseUrl:'http://127.0.0.1:17355/v1',hermesCommand:'hermes'},
    agentPrompt:'Executor',experiencePrompt:'Recorder',
    runAgent:async()=>events.map(event=>JSON.stringify(event)).join('\n'),
    fetcher:async(url,init)=>{
      posted={url,body:JSON.parse(init.body)};
      return Response.json({choices:[{message:{content:JSON.stringify(agent)}}]});
    },
    onExperience:payload=>{capture=payload;},
  });
  assert.equal(result.status,'failed');
  assert.equal(capture.captureMethod,'postrun_model');
  assert.equal(capture.experience.scenario_key,'oauth.callback_pending');
  assert.equal(posted.url,'http://127.0.0.1:17355/v1/chat/completions');
  assert.equal(posted.body.messages[0].role,'system');
  assert.equal(posted.body.messages[1].role,'user');
  assert.equal(posted.body.response_format.type,'json_object');
  const input=JSON.stringify(posted.body.messages[1]);
  assert.ok(!input.includes('sensitive.example'));
  assert.ok(input.includes('failed'));
  assert.equal(sample({result,experience:capture.experience,captureMethod:capture.captureMethod}).source,'postrun_model');
});

test('postrun recorder model failure preserves task outcome and an honest fallback candidate',async()=>{
  const {runLocalEscalation}=await import('../.bin/neo-local-escalation.mjs');
  const outcome={status:'failed',summary:'cannot connect',reason:'offline',user_action:null,evidence:[],notification:null};
  let captured;
  const result=await runLocalEscalation({handoff:'Local gateway unavailable',cwd:'/tmp',onNeedsUser:'none'},{
    config:{engine:'external',model:'model',context:65536,maxTurns:3,budgetSeconds:15,baseUrl:'http://127.0.0.1:17356/v1',hermesCommand:'hermes'},
    agentPrompt:'Executor',experiencePrompt:'Recorder',
    runAgent:async()=>JSON.stringify({type:'result',exit_code:0,text:JSON.stringify(outcome)}),
    fetcher:async()=>Response.json({error:'not available'}, {status:503}),
    onExperience:payload=>{captured=payload;},
  });
  assert.equal(result.status,'failed');
  assert.equal(captured.experience,undefined);
  assert.equal(sample({result,experience:captured.experience}).source,'fallback');
});
