import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventsBusCore, MAX_MEMORY_EVENTS, normalizePublishEvent } from './events-core.mjs';
import { resolveRuntimeConfig, writeRuntimeConfig, publishSubjectFor } from './config.mjs';

test('runtime config is one discovery source for NATS and API', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'events-bus-config-'));
  const env={EVENTS_BUS_DATA_DIR:dir,EVENTS_BUS_NATS_URL:'nats://127.0.0.1:5222',EVENTS_BUS_API_URL:'http://127.0.0.1:5223',EVENTS_BUS_SUBJECT_PREFIX:'test.events'};
  const config=resolveRuntimeConfig(env); writeRuntimeConfig(config,env);
  const discovered=resolveRuntimeConfig({EVENTS_BUS_DATA_DIR:dir});
  assert.equal(discovered.natsUrl,'nats://127.0.0.1:5222');
  assert.equal(discovered.apiUrl,'http://127.0.0.1:5223');
  assert.equal(discovered.subjectPrefix,'test.events');
});

test('core owns history cursor/filter semantics', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'events-bus-core-'));
  const config={...resolveRuntimeConfig({EVENTS_BUS_DATA_DIR:dir}),dataDir:dir,historyFile:path.join(dir,'events.jsonl')};
  const core=new EventsBusCore({config});
  const one=normalizePublishEvent({job_id:'job1',task_id:'a task',type:'task.started',status:'running',visibility:'orchestrator',message:'start'}).event;
  const two=normalizePublishEvent({job_id:'job1',task_id:'a task',type:'task.completed',status:'succeeded',visibility:'orchestrator',message:'done'}).event;
  core.appendEvent('test.job1.task.started',one); core.appendEvent('test.job1.task.completed',two);
  const history=core.history('job1',0,10,'a task');
  assert.equal(history.events.length,2); assert.equal(history.next_cursor,2); assert.equal(history.order,'asc');
  const recent=core.history('job1',0,1,'a task','desc'); assert.equal(recent.events[0].event.type,'task.completed'); assert.equal(recent.order,'desc');
  assert.equal(core.status('job1').terminal.event.type,'task.completed');
});

test('durable history is not evicted by unrelated live-buffer traffic', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'events-bus-history-retention-'));
  const historyFile=path.join(dir,'events.jsonl');
  const config={...resolveRuntimeConfig({EVENTS_BUS_DATA_DIR:dir}),dataDir:dir,historyFile};
  const target={cursor:1,subject:'test.quiet.progress',event:{job_id:'quiet',task_id:'target',type:'progress',status:'running',visibility:'user',message:'keep me'}};
  const rows=[JSON.stringify(target)];
  for(let i=0;i<MAX_MEMORY_EVENTS;i++) rows.push(JSON.stringify({cursor:i+2,subject:'test.noisy.progress',event:{job_id:'noisy',task_id:'spam',type:'progress',status:'running',visibility:'debug',message:'noise'}}));
  fs.writeFileSync(historyFile,rows.join('\n')+'\n');
  const core=new EventsBusCore({config});
  assert.equal(core.events.some(row=>row.event?.job_id==='quiet'),false);
  const history=core.history('quiet',0,10,null,'desc');
  assert.equal(history.events.length,1);
  assert.equal(history.events[0].event.message,'keep me');
  assert.equal(history.next_cursor,1);
});


test('events bus overrides producer timestamps at publish and persists recorder receipt time', () => {
  const bogus = '2026-10-08T04:00:00.000Z';
  const input = {job_id:'timestamp-check',task_id:'review',type:'task.started',status:'running',visibility:'user',message:'started',timestamp:bogus};
  const published = normalizePublishEvent(input).event;
  assert.notEqual(published.timestamp,bogus);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'events-bus-receipt-'));
  const config={...resolveRuntimeConfig({EVENTS_BUS_DATA_DIR:dir}),dataDir:dir,historyFile:path.join(dir,'events.jsonl')};
  const core=new EventsBusCore({config});
  core.appendEvent('test.timestamp-check.task.started', input);
  const stored=core.history('timestamp-check').events[0].event;
  assert.notEqual(stored.timestamp,bogus);
  assert.equal(JSON.parse(fs.readFileSync(config.historyFile,'utf8').trim()).event.timestamp,stored.timestamp);
  assert.equal(stored.receivedAt,undefined);
});

test('emit publishes to configured prefix without default leakage',()=>{
  const event={job_id:'iso-553',type:'task.started'};
  assert.equal(publishSubjectFor(event,{EVENTS_BUS_SUBJECT_PREFIX:'neo.events.private-run'}),'neo.events.private-run.iso-553.task.started');
  assert.equal(publishSubjectFor(event,{EVENTS_BUS_DATA_DIR:fs.mkdtempSync(path.join(os.tmpdir(),'events-default-'))}),'relay.events.job.iso-553.task.started');
  assert.throws(()=>publishSubjectFor({job_id:'iso-553'},{}),/Job ID and event type/);
});


test('Events Bus rejects unmigrated saved namespace and ignores retired event env names',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'events-bus-migrate-'));
  try {
    fs.writeFileSync(path.join(dir,'runtime.json'),JSON.stringify({subjectPrefix:'neo.events.job'}));
    assert.throws(()=>resolveRuntimeConfig({EVENTS_BUS_DATA_DIR:dir}),/coordinate migration/);
    const runtime=resolveRuntimeConfig({EVENTS_BUS_DATA_DIR:dir,EVENTS_BUS_SUBJECT_PREFIX:'relay.events.job'});
    assert.equal(runtime.subjectPrefix,'relay.events.job');
    const fresh=resolveRuntimeConfig({EVENTS_BUS_DATA_DIR:fs.mkdtempSync(path.join(os.tmpdir(),'events-bus-new-')),
      NEO_NATS_URL:'nats://legacy:4545',AGENTS_RELAY_EVENTS_SUBJECT_PREFIX:'wrong.old'});
    assert.equal(fresh.subjectPrefix,'relay.events.job');
    assert.equal(fresh.natsUrl,'nats://127.0.0.1:4222');
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});


test('Events Bus rejects invalid saved runtime JSON rather than silently switching subject',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'events-corrupt-runtime-'));
  try {
    const file=path.join(dir,'runtime.json');
    for (const payload of ['{corrupt','[]','null']) {
      fs.writeFileSync(file,payload);
      assert.throws(()=>resolveRuntimeConfig({EVENTS_BUS_CONFIG:file}),/Invalid Events Bus runtime config/);
    }
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
