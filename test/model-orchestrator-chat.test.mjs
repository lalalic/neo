import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ModelStore} from '../services/models/store.mjs';
import {OrchestratorChat,parseOrchestratorEnvelope} from '../services/models/orchestrator-chat.mjs';
import {createModelServer} from '../services/models/server.mjs';
import {createTurnPrompt} from '../services/models/prompt.mjs';
const head={threadId:'chatgpt-head-original',projectId:'g-p-12345678901234567890123456789012'};
const envelope=message=>JSON.stringify({schema:'neo.orchestrator.reply.v1',message:{text:message,level:'info',needs:'none',jobId:null}});
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(t,reply=envelope('hello')){
  const dir=mkdtempSync(join(tmpdir(),'orchestrator-test-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const store=new ModelStore(join(dir,'models'));
  const headFile=join(dir,'legacy-head.json');writeFileSync(headFile,JSON.stringify(head));
  const calls=[];
  const engine={async run(body,opts){calls.push({body,opts});return {output:[{content:[{text:reply}]}]}}};
  return {store,headFile,engine,calls};
}
test('preserves pre-existing Project/head with persistent fixed Codex UUID, never creates competing head',t=>{
  const {store,headFile,engine}=fixture(t);
  const one=new OrchestratorChat({store,engine,legacyHeadFile:headFile});
  assert.equal(one.state.projectId,head.projectId);
  assert.equal(one.state.threadId,head.threadId);
  const sessions=store.listSessions();assert.equal(sessions.length,1);
  assert.equal(sessions[0].threadId,head.threadId);
  assert.equal(sessions[0].codexThreadId,one.state.codexThreadId);
  const two=new OrchestratorChat({store:new ModelStore(store.base),engine,legacyHeadFile:headFile});
  assert.equal(two.state.codexThreadId,one.state.codexThreadId);
  assert.equal(store.listSessions().length,1);
});
test('durable idempotent outbox, request collision, completion events and ACK',async t=>{
  const {store,headFile,engine,calls}=fixture(t);
  const chat=new OrchestratorChat({store,engine,legacyHeadFile:headFile});
  const id='phone_request_123';
  assert.equal((await chat.submit({requestId:id,text:'hello'})).status,'queued');
  await flush();
  assert.equal((await chat.submit({requestId:id,text:'hello'})).status,'completed');
  await assert.rejects(()=>chat.submit({requestId:id,text:'different'}),/conflict/);
  assert.equal(calls.length,1);
  assert.equal(calls[0].opts.codexThreadId,chat.state.codexThreadId);
  assert.match(calls[0].body.enforcement_context,/one COMPLETE JSON envelope/);
  const combined=createTurnPrompt({responseId:'resp_'+'f'.repeat(40),
    messages:[{role:'user',content:'hello'}],
    callerEnforcementContext:calls[0].body.enforcement_context});
  assert.ok(combined.enforcement_context.length<=1500,
    `WebHelm cap exceeded: ${combined.enforcement_context.length} characters`);
  assert.match(combined.enforcement_context,/reply\.text seq=1/);
  assert.match(combined.enforcement_context,/chat_report/);
  assert.match(combined.enforcement_context,/handoffReceipt/);
  assert.equal(chat.pending()[0].message.text,'hello');
  assert.deepEqual(chat.eventsAfter(0).map(e=>e.status),['queued','processing','completed']);
  const deliveryId=chat.pending()[0].deliveryId;
  assert.deepEqual(chat.ack(deliveryId),{deliveryId,acked:true});
  assert.deepEqual(chat.pending(),[]);
  const restored=new OrchestratorChat({store:new ModelStore(store.base),engine,legacyHeadFile:headFile});
  assert.equal((await restored.submit({requestId:id,text:'hello'})).status,'completed');
  assert.equal(calls.length,1);
});
test('incomplete request is uncertain on restart, never silently re-sent',async t=>{
  const {store,headFile,calls}=fixture(t);
  const engine={async run(){calls.push('started');return new Promise(()=>{});}};
  const one=new OrchestratorChat({store,engine,legacyHeadFile:headFile});
  await one.submit({requestId:'pending_12345',text:'hello'});await flush();
  const restored=new OrchestratorChat({store:new ModelStore(store.base),engine,legacyHeadFile:headFile});
  assert.equal(restored.pending()[0].status,'uncertain');
  assert.equal((await restored.submit({requestId:'pending_12345',text:'hello'})).status,'uncertain');
  assert.equal(calls.length,1);
});
test('restart resumes durably queued requests that never entered the browser',async t=>{
  const {store,headFile,engine,calls}=fixture(t);
  const original=new OrchestratorChat({store,engine,legacyHeadFile:headFile});
  await flush(); // Drain the first constructor's empty startup queue.
  original.state.requests.accepted_before_crash={
    requestId:'accepted_before_crash',text:'resumable',status:'queued',
    attachments:[],files:[],ack:false,createdAt:Date.now(),
  };
  original.persist(); // Simulate 202 persisted, process exit before transport start.
  const restored=new OrchestratorChat({store:new ModelStore(store.base),engine,legacyHeadFile:headFile});
  for(let i=0;i<10&&restored.pending()[0]?.status!=='completed';i++)await flush();
  assert.equal(restored.pending()[0].status,'completed');
  assert.equal(calls.length,1);
  assert.match(calls[0].body.input[0].content[0].text,/resumable/);
});

test('restart does not overtake an uncertain browser submission with newer turns',async t=>{
  const {store,headFile}=fixture(t);
  let firstStarted=0,successorCalls=0;
  const original=new OrchestratorChat({store,engine:{async run(){firstStarted++;return new Promise(()=>{});}},legacyHeadFile:headFile});
  await original.submit({requestId:'uncertain_first_123',text:'first'});
  await flush();
  assert.equal(firstStarted,1);
  const restored=new OrchestratorChat({store:new ModelStore(store.base),
    engine:{async run(){successorCalls++;return {output:[{content:[{text:envelope('bad overtaking')}]}]};}},
    legacyHeadFile:headFile});
  await restored.submit({requestId:'later_queued_12345',text:'second'});
  await flush();await flush();
  assert.deepEqual(restored.pending().map(r=>r.status),['uncertain','queued']);
  assert.equal(successorCalls,0,'The next ChatGPT turn must not overtake an unconfirmed prior turn');
  const restarted=new OrchestratorChat({store:new ModelStore(store.base),engine:restored.engine,legacyHeadFile:headFile});
  await flush();
  assert.deepEqual(restarted.pending().map(r=>r.status),['uncertain','queued']);
  assert.equal(successorCalls,0);
});
test('lost internal v1 SSE never releases FIFO until the durable exact response completes',async t=>{
  const {store,headFile}=fixture(t);
  const calls=[];
  const responseId='resp_'+'a'.repeat(40);
  const engine={async run(body,opts){
    calls.push(body.input[0].content[0].text);
    if(calls.length===1){
      const session=store.listSessions()[0];
      session.lastResponseId=responseId;session.status='awaiting';store.putSession(session);
      store.putResponse({id:responseId,object:'response',status:'in_progress',sessionId:session.id,
        output:[],model:'neo'});
      opts.onResponseStarted?.(responseId);
      throw Error('Internal /v1 SSE disconnected after possible WebHelm submission');
    }
    return {output:[{content:[{text:envelope('next completed')}]}]};
  }};
  const original=new OrchestratorChat({store,engine,legacyHeadFile:headFile});
  await original.submit({requestId:'sse_first_uncertain_123',text:'first'});
  await flush();
  assert.equal(original.pending()[0].status,'uncertain');
  await original.submit({requestId:'sse_second_queued_123',text:'next'});
  await flush();
  assert.deepEqual(original.pending().map(x=>x.status),['uncertain','queued']);
  assert.equal(calls.length,1,'Never send next turn while the previous browser outcome is uncertain');
  const restarted=new OrchestratorChat({store:new ModelStore(store.base),engine,legacyHeadFile:headFile});
  await flush();
  assert.equal(calls.length,1,'Restart must not re-submit an unknown browser outcome');
  const {reportText,reportComplete}=await import('../services/models/report.mjs');
  reportText(store,responseId,envelope('recovered from durable /v1'));
  reportComplete(store,responseId);
  await restarted.reconcileUncertain();
  for(let i=0;i<100&&restarted.pending()[1]?.status!=='completed';i++)await flush();
  assert.deepEqual(restarted.pending().map(x=>x.status),['completed','completed']);
  assert.equal(restarted.pending()[0].message.text,'recovered from durable /v1');
  assert.equal(calls.length,2);
  assert.deepEqual(calls,['first','next'],'Only the later never-sent turn uses the transport again');
});
test('untrusted control fails closed without verifier and never updates head',async t=>{
  const {store,headFile}=fixture(t);
  const control={action:'replace-thread-id',previousThreadId:head.threadId,nextThreadId:'successor_thread_123',expectedGeneration:0,handoffReceipt:'receipt_verified_123'};
  const raw=JSON.stringify({schema:'neo.orchestrator.reply.v1',control});
  const chat=new OrchestratorChat({store,engine:{async run(){return {output:[{content:[{text:raw}]}]}}},legacyHeadFile:headFile});
  await chat.submit({requestId:'control_12345',text:'handoff'});await flush();
  assert.equal(chat.pending()[0].status,'failed');
  assert.equal(chat.state.threadId,head.threadId);
  assert.equal(store.listSessions()[0].threadId,head.threadId);
});
test('a message paired with an unverified replacement fails closed',async t=>{
  const {store,headFile}=fixture(t);
  const control={action:'replace-thread-id',previousThreadId:head.threadId,nextThreadId:'successor_thread_123',expectedGeneration:0,handoffReceipt:'receipt_verified_123'};
  const raw=JSON.stringify({schema:'neo.orchestrator.reply.v1',message:{text:'handoff succeeded',level:'info',needs:'none',jobId:null},control});
  const chat=new OrchestratorChat({store,engine:{async run(){return {output:[{content:[{text:raw}]}]}}},legacyHeadFile:headFile});
  await chat.submit({requestId:'control_with_text_123',text:'handoff'});await flush();
  assert.equal(chat.pending()[0].status,'failed');
  assert.match(chat.pending()[0].message.text,/Independent thread\/handoff verifier unavailable/);
  assert.equal(chat.state.threadId,head.threadId);
  assert.equal(store.listSessions()[0].threadId,head.threadId);
});
test('verified CAS replacement enforces generation, predecessor and project mapping',async t=>{
  const {store,headFile,engine}=fixture(t);
  const verified=[];
  const chat=new OrchestratorChat({store,engine,legacyHeadFile:headFile,verifyHandoff:async candidate=>{verified.push(candidate);return candidate.projectId===head.projectId;}});
  const first={action:'replace-thread-id',previousThreadId:head.threadId,nextThreadId:'new_head_b_123456',expectedGeneration:0,handoffReceipt:'receipt_1234567890'};
  assert.equal(await chat.replaceThread(first),1);
  assert.equal(chat.state.threadId,first.nextThreadId);
  assert.equal(store.listSessions()[0].threadId,first.nextThreadId);
  assert.equal(await chat.replaceThread(first),1,'Identical accepted replacement is idempotent');
  const tampered=store.listSessions()[0];tampered.projectId='g-p-00000000000000000000000000000000';store.putSession(tampered);
  await assert.rejects(()=>chat.replaceThread({...first,previousThreadId:first.nextThreadId,nextThreadId:'new_head_c_123456',expectedGeneration:1}),/mapping.*mismatch/);
  assert.equal(chat.state.threadId,first.nextThreadId);
  assert.equal(verified[0].projectId,head.projectId);
});
test('simulated A to B to C self-handoffs retain fixed Codex UUID and fresh enforcement context',async t=>{
  const {store,headFile}=fixture(t);
  const threads=['successor_b_123456','successor_c_123456'];
  const calls=[],verified=[];
  const engine={async run(body,opts){
    calls.push({body,opts});
    const index=calls.length-1;
    const control={action:'replace-thread-id',
      previousThreadId:index===0?head.threadId:threads[index-1],
      nextThreadId:threads[index],expectedGeneration:index,
      handoffReceipt:'receipt_confirmed_'+index+'_123456'};
    return {output:[{content:[{text:JSON.stringify({schema:'neo.orchestrator.reply.v1',control})}]}]};
  }};
  const chat=new OrchestratorChat({store,engine,legacyHeadFile:headFile,
    verifyHandoff:async candidate=>{
      verified.push(candidate);
      return candidate.projectId===head.projectId;
    }});
  const codex=chat.state.codexThreadId;
  await chat.submit({requestId:'handoff_a_to_b_123',text:'Start B handoff'});
  for(let i=0;i<40&&chat.state.generation!==1;i++)await flush();
  assert.equal(chat.state.threadId,threads[0]);
  assert.equal(chat.state.generation,1);
  await chat.submit({requestId:'handoff_b_to_c_123',text:'Start C handoff'});
  for(let i=0;i<40&&chat.state.generation!==2;i++)await flush();
  assert.equal(chat.state.threadId,threads[1]);
  assert.equal(chat.state.generation,2);
  assert.equal(store.listSessions().find(s=>s.codexThreadId===codex).threadId,threads[1]);
  assert.deepEqual(calls.map(c=>c.opts.codexThreadId),[codex,codex]);
  assert.match(calls[0].body.enforcement_context,/Current handoff generation: 0/);
  assert.match(calls[0].body.enforcement_context,/Current ChatGPT Thread: chatgpt-head-original/);
  assert.match(calls[1].body.enforcement_context,/Current handoff generation: 1/);
  assert.match(calls[1].body.enforcement_context,/Current ChatGPT Thread: successor_b_123456/);
  assert.equal(verified.length,2);
  assert.equal(chat.pending().every(x=>x.status==='completed'&&x.message===null),true,
    'Control-only envelopes never expose a fake owner-visible bubble');
});
test('crash after Models mapping CAS repairs adapter head without resubmitting any turn',async t=>{
  const {store,headFile,engine}=fixture(t);
  const control={action:'replace-thread-id',previousThreadId:head.threadId,
    nextThreadId:'successor_thread_crash123',expectedGeneration:0,
    handoffReceipt:'receipt_crash_proof_123'};
  const verifyHandoff=async()=>true;
  const chat=new OrchestratorChat({store,engine,legacyHeadFile:headFile,verifyHandoff});
  const persist=chat.persist.bind(chat);
  let crashed=false;
  chat.persist=()=>{
    if(!crashed&&chat.state.threadId===control.nextThreadId){
      crashed=true;throw Error('simulated disk crash after CAS');
    }
    return persist();
  };
  await assert.rejects(()=>chat.replaceThread(control),/simulated disk crash/);
  const session=store.listSessions().find(x=>x.codexThreadId===chat.state.codexThreadId);
  assert.equal(session.threadId,control.nextThreadId,'Models commit is authoritative');
  assert.equal(session.orchestratorGeneration,1);
  const restored=new OrchestratorChat({store:new ModelStore(store.base),engine,
    legacyHeadFile:headFile,verifyHandoff});
  assert.equal(restored.state.threadId,control.nextThreadId);
  assert.equal(restored.state.generation,1);
  assert.equal(restored.state.pendingHandoff,undefined);
  assert.equal(await restored.replaceThread(control),1,'Exact accepted control replay is idempotent');
});

test('crash before CAS preserves old head and drops incomplete stage on startup',async t=>{
  const {store,headFile,engine}=fixture(t);
  const control={action:'replace-thread-id',previousThreadId:head.threadId,
    nextThreadId:'successor_before_cas123',expectedGeneration:0,
    handoffReceipt:'receipt_crash_before_123'};
  const chat=new OrchestratorChat({store,engine,legacyHeadFile:headFile,
    verifyHandoff:async()=>true});
  chat.state.pendingHandoff={...control};
  chat.persist();
  const restored=new OrchestratorChat({store:new ModelStore(store.base),engine,
    legacyHeadFile:headFile,verifyHandoff:async()=>true});
  assert.equal(restored.state.threadId,head.threadId);
  assert.equal(restored.state.generation,0);
  assert.equal(restored.state.pendingHandoff,undefined);
  assert.equal(store.listSessions().find(x=>x.codexThreadId===restored.state.codexThreadId).threadId,head.threadId);
});
test('strict typed envelope rejects excess fields, invalid need, unsafe job, and forged handoff receipt',()=>{
  const base={schema:'neo.orchestrator.reply.v1',
    message:{text:'hello',level:'info',needs:'none',jobId:null}};
  const bad=[
    'hello','{}','{"schema":"neo.orchestrator.reply.v1"}',
    JSON.stringify({...base,message:{...base.message,level:'admin'}}),
    JSON.stringify({...base,hidden:'private control data'}),
    JSON.stringify({...base,message:{...base.message,unexpected:'private'}}),
    JSON.stringify({...base,message:{...base.message,needs:'internet'}}),
    JSON.stringify({...base,message:{...base.message,jobId:'../secret'}}),
    JSON.stringify({...base,message:{...base.message,text:''}}),
    JSON.stringify({...base,control:{action:'replace-thread-id',previousThreadId:'thread_old_1234',
      nextThreadId:'thread_new_1234',expectedGeneration:0,handoffReceipt:'spaces are not okay'}}),
    JSON.stringify({...base,control:{action:'replace-thread-id',previousThreadId:'thread_old_1234',
      nextThreadId:'thread_new_1234',expectedGeneration:0,handoffReceipt:'receipt_1234567890',ignoreChecks:true}}),
  ];
  for(const payload of bad)assert.throws(()=>parseOrchestratorEnvelope(payload));
  assert.equal(parseOrchestratorEnvelope(JSON.stringify(base)).message.text,'hello');
  const controlOnly={schema:'neo.orchestrator.reply.v1',control:{
    action:'replace-thread-id',previousThreadId:'thread_old_1234',
    nextThreadId:'thread_new_1234',expectedGeneration:0,handoffReceipt:'receipt_1234567890',
  }};
  assert.equal(parseOrchestratorEnvelope(JSON.stringify(controlOnly)).message,null);
});
test('HTTP rejects missing legacy head and never creates competing model thread',async t=>{
  const {store,engine,calls}=fixture(t);
  const {server}=createModelServer({token:'test-token-12345678901234567890',store,transport:{},orchestratorLegacyHeadFile:join(store.base,'missing-head.json')});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const headers={authorization:'Bearer test-token-12345678901234567890','content-type':'application/json'};
  const bad=await fetch(base+'/orchestrator-chat/messages',{method:'POST',
    headers:{...headers,'idempotency-key':'request_123456'},
    body:JSON.stringify({requestId:'request_123456',text:'hello'})});
  assert.equal(bad.status,503);
  assert.equal(store.listSessions().length,0);
  assert.equal(calls.length,0);
  const noAuth=await fetch(base+'/orchestrator-chat/pending');assert.equal(noAuth.status,401);
  assert.equal((await fetch(base+'/orchestrator-chat/health')).status,401);
  const missing=await fetch(base+'/orchestrator-chat/health',{headers});
  assert.equal(missing.status,503);
  assert.equal((await missing.json()).ready,false);
});

test('real HTTP 202 -> whole-message event -> pending -> ACK with existing ChatGPT head',async t=>{
  const {store,headFile}=fixture(t);
  const calls=[];
  const transport={
    async newThread(){throw Error('must not initialize a new Orchestrator conversation');},
    async newTurn(threadId,prompt,files,responseId,projectId){
      calls.push({threadId,responseId,projectId,prompt});return {status:'submitted',thread_id:threadId,queue_id:'queued_'+responseId};
    },
    async waitForResult(responseId,s){
      const {reportText,reportComplete}=await import('../services/models/report.mjs');
      reportText(s,responseId,envelope('delivered once'));
      reportComplete(s,responseId);
    },
  };
  const token='test-token-12345678901234567890';
  const app=createModelServer({token,store,transport,orchestratorLegacyHeadFile:headFile});
  const {server}=app;
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const headers={authorization:'Bearer '+token,'content-type':'application/json'};
  const send=(path,body)=>fetch(base+path,{method:'POST',
    headers:{...headers,...(path==='/orchestrator-chat/messages'?{'idempotency-key':body.requestId}:{})},
    body:JSON.stringify(body)});
  const id='phone_123456789';
  const missingKey=await fetch(base+'/orchestrator-chat/messages',{method:'POST',headers,
    body:JSON.stringify({requestId:id,text:'Please answer'})});
  assert.equal(missingKey.status,400);
  const wrongKey=await fetch(base+'/orchestrator-chat/messages',{method:'POST',
    headers:{...headers,'idempotency-key':'wrong_request_123'},
    body:JSON.stringify({requestId:id,text:'Please answer'})});
  assert.equal(wrongKey.status,400);
  assert.equal(calls.length,0,'Mismatched HTTP identity must fail before model transport');
  const accepted=await send('/orchestrator-chat/messages',{requestId:id,text:'Please answer'});
  assert.equal(accepted.status,202);
  await new Promise(resolve=>setTimeout(resolve,10));
  const pending=await (await fetch(base+'/orchestrator-chat/pending',{headers})).json();
  assert.equal(pending.pending.length,1);
  assert.equal(pending.pending[0].message.text,'delivered once');
  assert.equal(calls.length,1);
  const health=await fetch(base+'/orchestrator-chat/health',{headers});
  assert.equal(health.status,200);
  const privateReadiness=await health.json();
  assert.equal(privateReadiness.ready,true);
  assert.equal(privateReadiness.unacknowledged,1);
  assert.equal(privateReadiness.modelApi,'available');
  assert.doesNotMatch(JSON.stringify(privateReadiness),/chatgpt-head-original|g-p-123|codexThreadId|responseId|PRIVATE/);
  assert.equal(calls[0].threadId,head.threadId);
  assert.equal(calls[0].projectId,head.projectId);
  assert.match(calls[0].prompt,/Please answer/);
  const replay=await fetch(base+'/orchestrator-chat/events?cursor=1',{headers});
  assert.equal(replay.status,200);
  const reader=replay.body.getReader();const part=await reader.read();
  assert.match(new TextDecoder().decode(part.value),/event: message.processing|event: message.completed/);
  assert.match(pending.pending[0].deliveryId,/^delivery_[a-f0-9]{40}$/);
  await reader.cancel();
  const ack=await send('/orchestrator-chat/ack',{deliveryId:pending.pending[0].deliveryId});
  assert.equal(ack.status,200);
  assert.deepEqual((await (await fetch(base+'/orchestrator-chat/pending',{headers})).json()).pending,[]);
  const state=app.getOrchestrator().state;
  assert.equal(state.requests[id].message,undefined,'ACK must scrub owner-visible reply text');
  assert.equal(state.requests[id].text,undefined,'ACK must scrub owner message text');
  assert.match(state.requests[id].dedupeHash,/^[a-f0-9]{64}$/);
  assert.equal(state.events.some(e=>e.message?.text?.includes('delivered once')),false);
  assert.match(state.requests[id].v1ResponseId,/^resp_[a-f0-9]{40}$/);
  const response=store.response(state.requests[id].v1ResponseId);
  assert.equal(response.scrubbed,true);
  assert.deepEqual(response.output,[],'Only ACKed Orchestrator v1 outputs are scrubbed');
  assert.deepEqual(store.listSessions().find(s=>s.codexThreadId===state.codexThreadId).lastInput,[]);
  const repeated=await send('/orchestrator-chat/messages',{requestId:id,text:'Please answer'});
  assert.equal(repeated.status,202);assert.equal(calls.length,1);
  const duplicate=await send('/orchestrator-chat/messages',{requestId:id,text:'different'});
  assert.equal(duplicate.status,409,'Conflicting idempotency payload is HTTP 409 per spec');
  assert.equal((await fetch(base+'/orchestrator-chat/events?cursor=999999',{headers})).status,400);
  assert.equal((await send('/orchestrator-chat/ack',{deliveryId:'unknown_delivery_123'})).status,400);
});

test('expired SSE baseline cursor zero forces pending recovery instead of impossible replay',async t=>{
  const {store,headFile}=fixture(t);
  const token='cursor-expiry-token-1234567890';
  const app=createModelServer({token,store,transport:{},orchestratorLegacyHeadFile:headFile});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>app.server.close(resolve)));
  const chat=app.getOrchestrator();
  chat.state.sequence=1002;
  chat.state.events=[{id:1001,requestId:'old_request_1234',status:'completed',
    deliveryId:'delivery_'+'a'.repeat(40)}];
  chat.persist();
  const base='http://127.0.0.1:'+app.server.address().port;
  const headers={authorization:'Bearer '+token};
  const stale=await fetch(base+'/orchestrator-chat/events?cursor=0',{headers});
  assert.equal(stale.status,409);
  assert.match(JSON.stringify(await stale.json()),/recover via pending/);
  const recovery=await (await fetch(base+'/orchestrator-chat/pending',{headers})).json();
  assert.equal(recovery.cursor,1002);
  assert.deepEqual(recovery.pending,[]);
});
test('Orchestrator rejects two reply.text fragments even when joined JSON is valid',async t=>{
  const {store,headFile}=fixture(t);
  const raw=envelope('two partial reports');
  const split=raw.indexOf('"message"');
  assert.ok(split>0);
  assert.doesNotThrow(()=>JSON.parse(raw.slice(0,split)+'\n'+raw.slice(split)));
  const transport={
    async newThread(){throw Error('A competing head is not allowed')},
    async newTurn(threadId){assert.equal(threadId,head.threadId);return {status:'queued',queue_id:'durable_123'}},
    async waitForResult(id,s){
      const {reportText,reportComplete}=await import('../services/models/report.mjs');
      reportText(s,id,raw.slice(0,split));
      reportText(s,id,raw.slice(split));
      reportComplete(s,id);
    },
  };
  const token='model-one-complete-report-token-123456';
  const app=createModelServer({token,store,transport,orchestratorLegacyHeadFile:headFile});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>app.server.close(resolve)));
  const requestId='single_fragment_rule_1234';
  const base='http://127.0.0.1:'+app.server.address().port;
  const headers={authorization:'Bearer '+token,'content-type':'application/json',
    'idempotency-key':requestId};
  assert.equal((await fetch(base+'/orchestrator-chat/messages',{method:'POST',
    headers,body:JSON.stringify({requestId,text:'Answer once'})})).status,202);
  for(let i=0;i<60&&app.getOrchestrator().state.requests[requestId].status==='processing';i++)await flush();
  const req=app.getOrchestrator().state.requests[requestId];
  assert.equal(req.status,'failed');
  assert.match(req.message.text,/exactly one complete reply.text/);
  assert.doesNotMatch(JSON.stringify(app.getOrchestrator().pending()),/two partial reports/);
});
test('live SSE survives completed GET request, resumes from cursor, and unsubscribes on response close',async t=>{
  const {store,headFile}=fixture(t);
  const sent=[];
  const transport={
    async newThread(){throw Error('Never create a competing ChatGPT head')},
    async newTurn(threadId,prompt,files,responseId,projectId){
      assert.equal(threadId,head.threadId);
      sent.push(responseId);
      return {status:'queued',queue_id:'queue_'+responseId};
    },
    async waitForResult(id,s){
      const {reportText,reportComplete}=await import('../services/models/report.mjs');
      reportText(s,id,envelope('SSE live delivered'));
      reportComplete(s,id);
    },
  };
  const token='sse-live-token-1234567890123456789';
  const app=createModelServer({token,store,transport,orchestratorLegacyHeadFile:headFile});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>app.server.close(resolve)));
  const base='http://127.0.0.1:'+app.server.address().port;
  const headers={authorization:'Bearer '+token,'content-type':'application/json'};
  const post=(requestId,text)=>fetch(base+'/orchestrator-chat/messages',
    {method:'POST',headers:{...headers,'idempotency-key':requestId},body:JSON.stringify({requestId,text})});
  const first='sse_first_12345',next='sse_second_12345';
  assert.equal((await post(first,'First')).status,202);
  let cursor=0,complete=false;
  for(let i=0;i<50;i++){
    const summary=await (await fetch(base+'/orchestrator-chat/pending',{headers})).json();
    cursor=summary.cursor;
    complete=summary.pending[0]?.status==='completed';
    if(complete)break;
    await flush();
  }
  assert.equal(complete,true);
  assert.equal(cursor,3,'First request emits queued/processing/completed events');
  const abort=new AbortController();
  const connectedAt=Date.now();
  const live=await fetch(base+'/orchestrator-chat/events?cursor='+cursor,
    {headers,signal:abort.signal});
  assert.ok(Date.now()-connectedAt<7000,
    'A current-cursor SSE connection must receive headers before the 15s heartbeat');
  assert.equal(live.status,200);
  assert.match(live.headers.get('content-type'),/text\/event-stream/);
  const reader=live.body.getReader();
  const orchestrator=app.getOrchestrator();
  assert.equal(orchestrator.listeners.size,1,
    'A live SSE response must remain subscribed after its GET request has been received');
  assert.equal((await post(next,'Second')).status,202);
  let text='';
  const deadline=Date.now()+4500;
  while(!text.includes('"requestId":"'+next+'"')||!text.includes('"status":"completed"')){
    if(Date.now()>deadline)throw Error('Live SSE did not deliver the subsequent terminal event');
    let timer;
    let chunk;
    try{
      chunk=await Promise.race([reader.read(),
        new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('SSE reader stalled')),4500)})]);
    }finally{clearTimeout(timer)}
    assert.equal(chunk.done,false);
    text+=new TextDecoder().decode(chunk.value);
  }
  assert.match(text,/id: 4\n/);
  assert.match(text,/id: 6\n/);
  assert.equal(sent.length,2);
  // Abort the HTTP stream before canceling the reader so the server receives
  // close immediately, rather than waiting for an SSE heartbeat.
  abort.abort();
  await reader.cancel().catch(()=>{});
  for(let i=0;i<50&&orchestrator.listeners.size;i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(orchestrator.listeners.size,0,'Closed SSE responses must release their live subscriptions');
});

test('attention notification retries durably with one request identity, never converting APNs into a chat ACK',async t=>{
  const {store,headFile}=fixture(t,envelope('background alert'));
  const sent=[];
  let failing=true;
  const notifier={async send(payload){sent.push(payload);if(failing)throw Error('APNs temporarily unavailable');return {ok:true,deliveryId:'apns_ok_12345'};}};
  const alert=JSON.stringify({schema:'neo.orchestrator.reply.v1',message:{text:'needs review',level:'attention',needs:'phone',jobId:null}});
  const engine={async run(){return {output:[{content:[{text:alert}]}]}}};
  const chat=new OrchestratorChat({store,engine,legacyHeadFile:headFile,notifier});
  await chat.submit({requestId:'notify_alert_12345',text:'check status'});
  await flush();await flush();
  const request=chat.state.requests.notify_alert_12345;
  assert.equal(request.status,'completed');
  assert.equal(request.notification.status,'pending');
  assert.equal(request.notification.attempts,1);
  assert.equal(sent[0].kind,'blocked');
  assert.equal(sent[0].idempotencyKey,'orchestrator:notify_alert_12345');
  // Simulate the durable retry timer elapsing after restart.
  request.notification.nextAttemptAt=0;chat.persist();
  failing=false;
  const restored=new OrchestratorChat({store:new ModelStore(store.base),engine,legacyHeadFile:headFile,notifier});
  await restored.flushNotifications();
  assert.equal(restored.state.requests.notify_alert_12345.notification.status,'delivered');
  assert.equal(restored.pending()[0].status,'completed');
  assert.equal(restored.pending()[0].message.text,'needs review');
  assert.deepEqual(sent.map(x=>x.idempotencyKey),['orchestrator:notify_alert_12345','orchestrator:notify_alert_12345']);
  await restored.flushNotifications();
  assert.equal(sent.length,2,'Acknowledged APNs delivery must not be duplicated');
  const notifiedDelivery=restored.pending()[0].deliveryId;
  assert.deepEqual(restored.ack(notifiedDelivery),{deliveryId:notifiedDelivery,acked:true});
});

test('ordinary completed reply uses policy-controlled APNs; disabled category is suppressed without retry',async t=>{
  const {store,headFile}=fixture(t);
  const sent=[];
  let enabled=true;
  const notifier={async send(payload){
    sent.push(payload);
    if(!enabled){
      const e=Error('Owner disabled completed notifications');
      e.code='NOTIFICATION_POLICY_DISABLED';
      throw e;
    }
    return {ok:true,deliveryId:'apns_complete_12345'};
  }};
  const engine={async run(){return {output:[{content:[{text:envelope('ordinary completion')}]}]}}};
  const chat=new OrchestratorChat({store,engine,legacyHeadFile:headFile,notifier});
  await chat.submit({requestId:'completion_enabled_1234',text:'hello'});
  await flush();await flush();
  assert.equal(chat.state.requests.completion_enabled_1234.notification.status,'delivered');
  assert.equal(sent[0].kind,'completed');
  enabled=false;
  await chat.submit({requestId:'completion_disabled_123',text:'next'});
  await flush();await flush();
  const suppressed=chat.state.requests.completion_disabled_123.notification;
  assert.equal(suppressed.status,'suppressed');
  assert.equal(suppressed.payload,undefined);
  assert.equal(suppressed.attempts,0);
  await chat.flushNotifications();
  assert.equal(sent.length,2,'Disabled owner-policy categories must not retry');
});
test('phone ACK scrubs chat content while preserving exact pending APNs retry payload',async t=>{
  const {store,headFile}=fixture(t);
  const sent=[];
  let reject=true;
  const notifier={async send(payload){sent.push(payload);if(reject)throw Error('temporary APNs outage');
    return {ok:true,deliveryId:'notifier_delivery_1234'};}};
  const alert=JSON.stringify({schema:'neo.orchestrator.reply.v1',
    message:{text:'Please review PRIVATE subject',level:'attention',needs:'phone',jobId:null}});
  const engine={async run(){return {output:[{content:[{text:alert}]}]}}};
  const chat=new OrchestratorChat({store,engine,legacyHeadFile:headFile,notifier});
  const requestId='apns_after_ack_1234';
  await chat.submit({requestId,text:'original request text'});
  await flush();await flush();
  assert.equal(chat.state.requests[requestId].notification.status,'pending');
  chat.ack(chat.pending()[0].deliveryId);
  assert.equal(chat.state.requests[requestId].text,undefined);
  assert.equal(chat.state.requests[requestId].message,undefined);
  reject=false;
  const restored=new OrchestratorChat({store:new ModelStore(store.base),engine,legacyHeadFile:headFile,notifier});
  restored.state.requests[requestId].notification.nextAttemptAt=0;
  await restored.flushNotifications();
  assert.equal(restored.state.requests[requestId].notification.status,'delivered');
  assert.equal(restored.state.requests[requestId].notification.payload,undefined,
    'Sanitized pending push text is discarded after APNs acceptance');
  assert.deepEqual(sent.map(x=>x.body),['Please review PRIVATE subject','Please review PRIVATE subject']);
  assert.equal(restored.state.requests[requestId].text,undefined);
});
test('concurrent phone and Relay wake submissions drain the same live FIFO without stranded requests',async t=>{
  const {store,headFile}=fixture(t);
  const calls=[];
  let unblock;
  const firstGate=new Promise(resolve=>{unblock=resolve});
  const engine={async run(body){calls.push(body.input[0].content[0].text);if(calls.length===1)await firstGate;
    return {output:[{content:[{text:envelope('processed')}]}]};}};
  const chat=new OrchestratorChat({store,engine,legacyHeadFile:headFile});
  await chat.submit({requestId:'phone_first_1234',text:'first'});
  await flush();
  await chat.submit({requestId:'relay_second_1234',text:'second'});
  await chat.submit({requestId:'phone_third_1234',text:'third'});
  assert.deepEqual(chat.pending().map(x=>x.status),['processing','queued','queued']);
  unblock();
  for(let i=0;i<30&&chat.pending().some(x=>x.status!=='completed');i++)await flush();
  assert.deepEqual(chat.pending().map(x=>x.status),['completed','completed','completed']);
  assert.equal(calls.length,3);
  assert.deepEqual(calls,['first','second','third']);
});

test('verified binary attachment is forwarded as a real file path, not only a filename in prompt',async t=>{
  const {createHash}=await import('node:crypto');
  const {readFileSync}=await import('node:fs');
  const {store,headFile}=fixture(t);
  const calls=[];
  const engine={async run(body,opts){
    calls.push({body,opts});
    const [file]=opts.attachmentFiles;
    assert.equal(readFileSync(file,'utf8'),'binary delivered');
    return {output:[{content:[{text:envelope('attached')}]}]};
  }};
  const chat=new OrchestratorChat({store,engine,legacyHeadFile:headFile});
  const requestId='attachment_request_123';
  const attachmentId='attachment_image_123';
  const content=Buffer.from('binary delivered');
  const hash=createHash('sha256').update(content).digest('hex');
  assert.deepEqual(await chat.upload({requestId,attachmentId,name:'sample.txt',
    chunkIndex:0,chunkCount:1,contentBase64:content.toString('base64'),sha256:hash,size:content.length}),
    {attachmentId,complete:true});
  await chat.submit({requestId,text:'Review attachment',attachments:[{id:attachmentId,name:'sample.txt'}]});
  await flush();
  assert.equal(chat.pending()[0].status,'completed');
  assert.equal(calls.length,1);
  assert.equal(calls[0].opts.attachmentFiles.length,1);
  assert.equal(calls[0].body.input[0].content[0].text,'Review attachment\n\nAttached files (verified, available locally for this turn): sample.txt');
  assert.equal((await chat.submit({requestId,text:'Review attachment',attachments:[{id:attachmentId,name:'sample.txt'}]})).status,'completed');
  assert.equal(calls.length,1,'idempotent retry must not attach or submit again');
  await assert.rejects(()=>chat.upload({requestId,attachmentId,name:'sample.txt',
    chunkIndex:0,chunkCount:1,contentBase64:content.toString('base64'),sha256:hash,size:content.length}),/after request acceptance/);
});

test('HTTP binary chunk acceptance -> WebHelm file path -> whole-message completion without lost attachments',async t=>{
  const {createHash}=await import('node:crypto');
  const {readFileSync}=await import('node:fs');
  const {store,headFile}=fixture(t);
  const calls=[];
  const transport={
    async newThread(){throw Error('must use the pre-existing verified head')},
    async newTurn(threadId,prompt,files,responseId,projectId){
      assert.equal(threadId,head.threadId);
      assert.equal(projectId,head.projectId);
      assert.equal(files.length,1);
      assert.equal(readFileSync(files[0],'utf8'),'http binary payload');
      calls.push({threadId,prompt,responseId,files});
      return {status:'queued',queue_id:'durable_queue_123'};
    },
    async waitForResult(id,s){
      const {reportText,reportComplete}=await import('../services/models/report.mjs');
      reportText(s,id,envelope('file was delivered'));reportComplete(s,id);
    },
  };
  const token='attachment-test-token-1234567890';
  const {server}=createModelServer({token,store,transport,orchestratorLegacyHeadFile:headFile});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base='http://127.0.0.1:'+server.address().port;
  const headers={'authorization':'Bearer '+token,'content-type':'application/json'};
  const post=(path,body)=>fetch(base+path,{method:'POST',
    headers:{...headers,...(path==='/orchestrator-chat/messages'?{'idempotency-key':body.requestId}:{})},
    body:JSON.stringify(body)});
  const bytes=Buffer.from('http binary payload');
  const requestId='http_attachment_12345',attachmentId='http_file_12345678',name='report.txt';
  const hash=createHash('sha256').update(bytes).digest('hex');
  const uploaded=await post('/orchestrator-chat/attachments',{
    requestId,attachmentId,name,chunkIndex:0,chunkCount:1,
    contentBase64:bytes.toString('base64'),sha256:hash,size:bytes.length,
  });
  assert.equal(uploaded.status,200);
  assert.equal((await uploaded.json()).complete,true);
  const data={requestId,text:'Read the file',attachments:[{id:attachmentId,name}]};
  assert.equal((await post('/orchestrator-chat/messages',data)).status,202);
  for(let i=0;i<30&&calls.length===0;i++)await flush();
  assert.equal(calls.length,1,'file path should reach the real transport boundary');
  const pending=await (await fetch(base+'/orchestrator-chat/pending',{headers})).json();
  assert.equal(pending.pending[0].status,'completed');
  assert.equal(pending.pending[0].message.text,'file was delivered');
  // Server acceptance must remain discoverable after the terminal ACK.
  // This lets a phone with an uncertain/lost 202 replay only the exact
  // message without hitting forbidden post-acceptance chunk uploads.
  assert.equal((await post('/orchestrator-chat/ack',{deliveryId:pending.pending[0].deliveryId})).status,200);
  const probe=await fetch(base+'/orchestrator-chat/pending?requestId='+requestId,{headers});
  assert.equal(probe.status,200);
  const known=await probe.json();
  assert.equal(known.accepted,true);
  assert.deepEqual(known.pending,[]);
  assert.equal((await (await fetch(base+'/orchestrator-chat/pending?requestId=unknown_file_1234',{headers})).json()).accepted,false);
  assert.equal((await fetch(base+'/orchestrator-chat/pending?requestId=..',{headers})).status,400);
  assert.equal((await post('/orchestrator-chat/messages',data)).status,202);
  const conflicting=await post('/orchestrator-chat/messages',{...data,text:'different'});
  assert.equal(conflicting.status,409,'Conflicting attachment message is HTTP 409 per spec');
  assert.equal(calls.length,1,'A lost 202 replay after ACK must not resend the attachment');
});
