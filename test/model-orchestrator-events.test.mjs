import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createOrchestratorEventMonitor,orchestratorRelayTurn} from '../services/models/orchestrator-events.mjs';
import {createLiveRegistry} from '../skills/chat-gateway/core/live-watch.mjs';

const job=(id,status,updatedAt='2026-11-20T12:00:00Z')=>({
  id,repository:'vlog',status,title:'Test '+id,
  createdAt:'2026-11-20T09:00:00Z',updatedAt,
});
function fixture(t,{down=false}={}){
  const stateDir=mkdtempSync(join(tmpdir(),'orchestrator-events-'));
  t.after(()=>rmSync(stateDir,{recursive:true,force:true}));
  let jobs=[job('old_123','COMPLETED')];
  const calls=[],subscribers=[];
  const orchestrator={state:{threadId:'existing_verified_head',projectId:'g-p-123'},
    async submit(args){calls.push(args);return {status:'queued',requestId:args.requestId}}};
  const dashboard={
    async fetchJobs(){if(down)throw Error('Dashboard offline');return jobs},
    async fetchJob(id,repo){return jobs.find(x=>x.id===id&&x.repository===repo)||job(id,'ACTIVE')},
  };
  const history={async latestCursor(){return 0},async after(id,cursor){return {events:[],next_cursor:cursor}}};
  const makeSubscriber=opts=>{
    const sub={...opts,running:false,start(){this.running=true},async stop(){this.running=false},status(){return {connected:this.running}}};
    subscribers.push(sub);return sub;
  };
  const config={natsUrl:'nats://127.0.0.1:4222',subject:'relay.events.job.*.job.runtime_status.changed',
    subjectPrefix:'relay.events.job',reconcileIntervalMs:600_000};
  return {stateDir,orchestrator,dashboard,history,makeSubscriber,config,calls,subscribers,setJobs:v=>jobs=v};
}
test('unreachable Dashboard fails closed before subscribing or notifying old jobs',async t=>{
  const f=fixture(t,{down:true});
  const mon=await createOrchestratorEventMonitor(f);
  await assert.rejects(()=>mon.start(),/Dashboard offline/);
  assert.equal(f.subscribers.length,0);
  assert.deepEqual(f.calls,[]);
  assert.equal(mon.status().baselined,false);
});
test('terminal event after baseline sends one stable Models request through same head and survives restart',async t=>{
  const f=fixture(t);
  let mon=await createOrchestratorEventMonitor(f);
  await mon.start();
  assert.equal(mon.status().baselined,true);
  assert.equal(mon.ledger.pending().length,0,'historically completed Job only baselined');
  const event={jobId:'new_123',to:'COMPLETED',updatedAt:'2026-11-20T12:05:00Z',repository:'vlog'};
  await f.subscribers[0].onEvent(event);
  await f.subscribers[0].onEvent(event);
  assert.equal(f.calls.length,1);
  assert.match(f.calls[0].requestId,/^relay-terminal-/);
  assert.match(f.calls[0].text,/authoritative Relay/);
  assert.doesNotMatch(f.calls[0].text,/chat_report\(/);
  assert.equal(mon.ledger.pending().length,0);
  await mon.stop();
  mon=await createOrchestratorEventMonitor(f);
  await mon.start();
  await f.subscribers.at(-1).onEvent(event);
  assert.equal(f.calls.length,1,'existing ledger must suppress replay after restart');
  await mon.stop();
});
test('watch uses safe Orchestrator envelope text and rejects duplicate unverified wakeups',async t=>{
  const f=fixture(t);
  const mon=await createOrchestratorEventMonitor(f);
  await mon.registry.add({repository:'vlog',jobId:'new_123',startCursor:0});
  await mon.start();
  assert.equal(f.subscribers.length,2);
  const event={type:'task.failed',jobId:'new_123',taskId:'task123',eventId:'event_id_1234567',
    timestamp:'2026-11-20T12:10:00Z'};
  assert.equal(await mon.watch.observe(event),true);
  await mon.dispatcher.tick();
  assert.equal(f.calls.length,1);
  assert.match(f.calls[0].requestId,/^relay-watch-/);
  assert.match(f.calls[0].text,/task.failed/);
  assert.doesNotMatch(f.calls[0].text,/mcp.chat-gateway/);
  assert.equal(await mon.watch.observe(event),false);
  await mon.stop();
});
test('interrupted legacy watch migration imports remaining watches without advancing already migrated cursors',async t=>{
  const f=fixture(t);
  const legacyDir=mkdtempSync(join(tmpdir(),'orchestrator-legacy-watches-'));
  t.after(()=>rmSync(legacyDir,{recursive:true,force:true}));
  const old=createLiveRegistry({dir:legacyDir});
  await old.add({repository:'vlog',jobId:'first_123',startCursor:5});
  await old.add({repository:'vlog',jobId:'second_123',startCursor:8});
  const queried=[];
  const history={
    async latestCursor(jobId){queried.push(jobId);return 42},
    async after(id,cursor){return {events:[],next_cursor:cursor}},
  };
  let monitor=await createOrchestratorEventMonitor({...f,legacyStateDir:legacyDir,history});
  // Simulate a prior process that copied the first watch, then crashed.
  await monitor.registry.add({repository:'vlog',jobId:'first_123',startCursor:11});
  await monitor.start();
  assert.deepEqual((await monitor.registry.list()).map(w=>[w.jobId,w.startCursor]),
    [['first_123',11],['second_123',42]]);
  assert.deepEqual(queried,['second_123']);
  assert.equal(f.calls.length,0,'historical watches must not notify owner on migration');
  await monitor.stop();
  monitor=await createOrchestratorEventMonitor({...f,legacyStateDir:legacyDir,history});
  await monitor.start();
  assert.deepEqual(queried,['second_123'],'restart must not rebaseline previously migrated watches');
  assert.equal((await monitor.registry.list()).length,2);
  await monitor.stop();
});
test('Relay prompt excludes untrusted job description and rejects malformed identity',()=>{
  const text=orchestratorRelayTurn({jobId:'new_123',repository:'vlog',to:'COMPLETED',kind:'job',
    prompt:'SECRET',token:'private',terminalUpdatedAt:'2026-11-20T12:00:00Z'});
  assert.doesNotMatch(text,/SECRET|private/);
  assert.throws(()=>orchestratorRelayTurn({jobId:'new_123',repository:'../private'}),/identity/);
});
