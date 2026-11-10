import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,readdirSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PassThrough} from 'node:stream';
import {
  prepareTaughtExperience,storeTaughtExperience,listExperience,renderTaughtExperience,
  relevantTaughtExperience,prepareExperience,storeExperience,
} from '../.bin/neo-escalation-experience.mjs';
import {
  callLocalModel,createLearningConversation,previewTaughtLesson,runLearningSession,
} from '../.bin/neo-escalation-learn.mjs';

const dir=mkdtempSync(join(tmpdir(),'neo-learn-tests-'));
process.on('exit',()=>rmSync(dir,{force:true,recursive:true}));

const candidate={
  scenario_key:'apple_developer.login_challenge',category:'authentication',
  symptom:'Apple Developer sign-in stuck after interactive verification request',
  strategy_key:'resume_existing_verified_session',
  steps:['Inspect the existing authorized sign-in session', 'Use an available approved verification route and resume the original task'],
  verification:'Confirm Apple Developer portal is authenticated and expected account is visible',
  failure_reason:'',lesson:'Keep the initial session alive while completing the verification step',
};

function response(message) {return {ok:true,json:async()=>({choices:[{message:{role:'assistant',content:message}}]})};}
function model(url,options) {
  const body=JSON.parse(options.body);
  const summary=body.messages[0].content.includes('Extract one reusable escalation');
  return Promise.resolve(response(summary?JSON.stringify(candidate):'Explain your symptoms, then give the exact solution steps.'));
}

test('teaching is classified as taught, never as verified success or training',()=>{
  const record=prepareTaughtExperience(candidate,{engine:'llama',model:'test-model'});
  assert.equal(record.outcome,'taught');
  assert.equal(record.source,'owner_taught');
  assert.equal(record.owner_confirmed,true);
  assert.equal(record.training_reviewed,false);
  assert.deepEqual(record.strategy.steps,candidate.steps);
  assert.match(previewTaughtLesson(record),/Apple Developer/);
  assert.match(previewTaughtLesson(record),/Keep the initial session/);
});

test('save, private file permissions, list, recall and explicit update',()=>{
  const cases=join(dir,'saved-cases');
  const record=prepareTaughtExperience(candidate);
  const saved=storeTaughtExperience(record,{dir:cases});
  assert.equal(saved.stored,true);
  assert.equal(saved.updated,false);
  assert.equal(statSync(cases).mode & 0o777,0o700);
  assert.equal(statSync(join(cases,record.id+'.json')).mode & 0o777,0o600);
  const matches=relevantTaughtExperience('Apple Developer login verification gets stuck',{dir:cases});
  assert.equal(matches.length,1);
  assert.equal(matches[0].outcome,'taught');
  assert.match(renderTaughtExperience('Apple Developer login verification gets stuck',{dir:cases}),/Inspect the existing/);
  assert.equal(relevantTaughtExperience('Unrelated video editing timeline',{dir:cases}).length,0);
  assert.equal(listExperience({dir:cases,search:'Apple Developer'}).length,1);
  const revised=prepareTaughtExperience({...candidate,lesson:'Do not close the waiting browser or CLI'});
  const update=storeTaughtExperience(revised,{dir:cases});
  assert.equal(update.updated,true);
  assert.equal(readdirSync(cases).length,1);
  assert.match(readFileSync(join(cases,record.id+'.json'),'utf8'),/Do not close/);
});

test('teaching cannot overwrite observed execution cases; rejects incomplete lessons',()=>{
  const cases=join(dir,'protected');
  const observed=prepareExperience({handoff:'existing',result:{status:'resolved'},experience:candidate});
  assert.equal(storeExperience(observed,{dir:cases}).stored,true);
  assert.throws(()=>storeTaughtExperience({...observed,source:'owner_taught',owner_confirmed:true}),/Only confirmed/);
  assert.equal(storeTaughtExperience(prepareTaughtExperience(candidate),{dir:cases}).updated,false);
  assert.throws(()=>prepareTaughtExperience({...candidate,steps:[]}),/at least one step/);
  assert.throws(()=>prepareTaughtExperience({...candidate,scenario_key:'alice@example.com'}),/safe stable/);
});

test('sensitive teaching content is redacted before durable storage',()=>{
  const record=prepareTaughtExperience({...candidate,steps:[
    'Visit https://example.test/path?token=abc and use secret=superprivate',
    'Open /Users/alice/private/credentials.txt after OTP 123456',
  ],lesson:'token=abcd12345 was only for local testing'});
  const raw=JSON.stringify(record);
  for(const secret of ['example.test','superprivate','/Users/alice','123456','abcd12345']) {
    assert.ok(!raw.includes(secret),'leaked '+secret);
  }
});

test('multi-turn teaching stays in memory; model draft is structured',async()=>{
  const conv=createLearningConversation({askModel:model,callTool:()=>{throw Error('should not execute tools')}});
  const baseUrl='http://127.0.0.1:9999/v1';
  assert.equal(conv.toolsEnabled,true,'interactive teaching starts with local tools enabled');
  assert.match(await conv.say(baseUrl,'A login needs help'),/Explain your symptoms/);
  assert.match(await conv.say(baseUrl,'Keep an existing login session open'),/exact solution/);
  assert.equal(conv.messages.length,5);
  const draft=await conv.draft(baseUrl);
  assert.equal(draft.strategy_key,candidate.strategy_key);
  assert.equal(conv.messages.length,5,'draft must not inject or persist its transcript');
  await assert.rejects(callLocalModel('https://remote.example/v1',[],{askModel:model}),/loopback/);
});

test('interactive CLI asks for owner approval and persists a lesson; quit discards conversation',async()=>{
  const cases=join(dir,'interactive');
  const previous=process.env.NEO_ESCALATION_CASES_DIR;
  process.env.NEO_ESCALATION_CASES_DIR=cases;
  const input=new PassThrough();
  const output=new PassThrough();
  let shown='';
  let supplied=0;
  const lines=['A sign-in challenge needs an existing session.','/remember','y','/quit'];
  const triggers=['You> ','You> ','Save or update this lesson? [y/N] ','You> '];
  output.on('data',buf=>{
    shown+=buf.toString();
    if(supplied<lines.length && shown.includes(triggers[supplied])){
      const current=supplied++;
      queueMicrotask(()=>input.write(lines[current]+'\n'));
      // Avoid re-using an earlier identical prompt when the loop returns.
      shown=shown.slice(shown.lastIndexOf(triggers[current])+triggers[current].length);
    }
  });
  try {
    await runLearningSession({
      inputStream:input,outputStream:output,askModel:model,
      modelRunner:async(run)=>run('http://127.0.0.1:9999/v1'),
      config:{engine:'external',model:'test-model'},
    });
    assert.equal(supplied,4,'must prompt for confirmation and then quit');
    const saved=listExperience({dir:cases});
    assert.equal(saved.length,1);
    assert.equal(saved[0].outcome,'taught');
  } finally {
    if(previous===undefined)delete process.env.NEO_ESCALATION_CASES_DIR;
    else process.env.NEO_ESCALATION_CASES_DIR=previous;
    input.destroy();output.destroy();
  }
});

test('CLI help exposes teach command and non-TTY refusal without launching local model',async()=>{
  const {execFileSync}=await import('node:child_process');
  const bin=new URL('../.bin/neo.mjs',import.meta.url).pathname;
  assert.match(execFileSync(bin,['escalation','--help'],{encoding:'utf8'}),/escalation learn/);
  assert.throws(()=>execFileSync(bin,['escalation','learn'],{encoding:'utf8',stdio:['pipe','pipe','pipe']}),/requires an interactive terminal/);
});


test('later Escalation includes matched owner teaching without implying prior success',async()=>{
  const {runStatelessAgent}=await import('../.bin/neo-stateless-agent.mjs');
  let seen;
  const outcome=await runStatelessAgent({
    baseUrl:'http://127.0.0.1:9999/v1',
    agentPrompt:'Tool-use local escalation executor.',
    request:{
      cwd:dir,handoff:'npm login',
      onNeedsUser:'none',
      learnedLessons:'Scenario: npm login waits for browser\n1. Keep PTY alive\nVerify: npm whoami',
    },
    config:{maxTurns:2,budgetSeconds:10},
    askModel:async(url,options)=>{
      seen=JSON.parse(options.body);
      return response(JSON.stringify({status:'needs_user',summary:'No actual login was performed',
        reason:'Authorized credentials not supplied',user_action:'Provide login consent',
        evidence:[],notification:null}));
    },
  });
  assert.match(JSON.stringify(seen.messages),/Keep PTY alive/);
  assert.match(JSON.stringify(seen.messages),/untrusted/);
  assert.match(outcome,/needs_user/);
});

test('declining /remember never writes a lesson',async()=>{
  const cases=join(dir,'declined');
  const prev=process.env.NEO_ESCALATION_CASES_DIR;
  process.env.NEO_ESCALATION_CASES_DIR=cases;
  const inp=new PassThrough();
  const out=new PassThrough();
  const commands=['This is a described login scenario','/remember','n','/quit'];
  const prompts=['You> ','You> ','Save or update this lesson? [y/N] ','You> '];
  let text='',i=0;
  out.on('data',buf=>{
    text+=buf.toString();
    if(i<commands.length && text.includes(prompts[i])){
      const idx=i++;text='';
      queueMicrotask(()=>inp.write(commands[idx]+'\n'));
    }
  });
  try {
    await runLearningSession({inputStream:inp,outputStream:out,askModel:model,
      modelRunner:async fn=>fn('http://127.0.0.1:9999/v1'),
      config:{engine:'external',model:'test'},
    });
    assert.equal(i,4);
    assert.deepEqual(listExperience({dir:cases}),[]);
  } finally {
    if(prev===undefined)delete process.env.NEO_ESCALATION_CASES_DIR;
    else process.env.NEO_ESCALATION_CASES_DIR=prev;
    inp.destroy();out.destroy();
  }
});
