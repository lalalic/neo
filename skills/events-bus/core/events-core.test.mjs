import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventsBusCore, MAX_MEMORY_EVENTS, normalizePublishEvent } from './events-core.mjs';
import { resolveRuntimeConfig, writeRuntimeConfig } from './config.mjs';

test('runtime config is one discovery source for NATS and API', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'events-bus-config-'));
  const env={EVENTS_BUS_DATA_DIR:dir,NEO_NATS_URL:'nats://127.0.0.1:5222',NEO_EVENTS_API_URL:'http://127.0.0.1:5223',NEO_EVENTS_SUBJECT_PREFIX:'test.events'};
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
