import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventsBusCore, MAX_MEMORY_EVENTS} from './events-core.mjs';
import {transportEnvelope,validatePublicEvent} from './envelope.mjs';
import {routeEvent,recordingBindings,acceptsRecord} from './routing.mjs';
import {resolveRuntimeConfig,writeRuntimeConfig} from './config.mjs';

function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'generic-bus-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  return {...resolveRuntimeConfig({EVENTS_BUS_DATA_DIR:dir}),subjectPrefix:'test.generic.'+path.basename(dir)+'.job'};
}
test('unknown event families and arbitrary object payloads need no domain configuration',t=>{
  const config=fixture(t),bus=new EventsBusCore({config});
  const input={type:'custom.notice',source:'arbitrary/source.* with spaces',data:{status:'anything',registry:'new',worker:{pid:123},extra:[1,2]}};
  const {subject,event}=routeEvent(input,config);
  assert.equal(subject.includes('*'),false);
  assert.deepEqual(event.data,input.data);
  assert.equal(event.job_id,undefined);
  assert.equal(event.status,undefined);
  assert.equal(bus.profile,undefined);
  for(const bad of [{...input,type:'a.>'},{...input,source:''},{...input,data:[]},{...input,event_id:'spoof'}])assert.throws(()=>validatePublicEvent(bad));
});
test('generic history filters by source, type, subject, cursor; durable receipt and dedupe',t=>{
  const config=fixture(t);
  const bus=new EventsBusCore({config});
  const source='sample/alpha/123';
  const one=routeEvent({type:'example.changed',source,data:{extra:1}},config);
  const envelope=transportEnvelope(one.event);
  bus.appendEvent(one.subject,envelope);
  assert.equal(bus.appendEvent(one.subject,envelope),null);
  const two=routeEvent({type:'example.closed',source,data:{}},config);
  bus.appendEvent(two.subject,transportEnvelope(two.event));
  assert.equal(bus.query({sourcePrefix:'sample/alpha/',type:'example.changed'}).events.length,1);
  assert.equal(bus.query({source,subject:two.subject,after:1}).events.length,1);
  const reopened=new EventsBusCore({config});
  assert.equal(reopened.appendEvent(one.subject,envelope),null);
  assert.equal(reopened.query({source,order:'desc',limit:1}).events[0].cursor,2);
});
test('generic real NATS round trip and history with no adapter',async t=>{
  const config=fixture(t);
  const bus=new EventsBusCore({config});
  t.after(()=>bus.close());
  await bus.startRecorder();
  const input={type:'arbitrary.happened',source:'my/novel/source',data:{anything:{value:42}}};
  const receipt=await bus.publish(input);
  assert.ok(receipt.published);
  for(let i=0;i<100&&!bus.query({source:input.source}).events.length;i++)await new Promise(r=>setTimeout(r,20));
  const rows=bus.query({source:input.source,type:input.type}).events;
  assert.equal(rows.length,1);
  assert.deepEqual(rows[0].event.data,input.data);
  assert.equal(rows[0].event.event_id,receipt.event.event_id);
});

test('declarative routing preserves existing wire subjects without interpreting domain fields',async t=>{
  const config=fixture(t);
  const prefix=config.subjectPrefix.slice(0,-4);
  const bus=new EventsBusCore({config}); t.after(()=>bus.close());
  await bus.startRecorder();
  const job=await bus.publish({type:'task.completed',source:'job/42/task/a/b/execution/lease',data:{verdict:'approved'}});
  const release=await bus.publish({type:'package.published',source:'release/fixture/abcdef',data:{registry:'future-registry',arbitrary:true}},{eventId:'test-release-id'});
  const reply=await bus.publish({type:'reply.text',source:'reply/models/test-response',data:{invalidForConsumer:true}});
  assert.equal(job.subject,prefix+'.job.42.task.completed');
  assert.equal(release.subject,prefix+'.release.fixture.package.published');
  assert.equal(reply.subject,prefix+'.reply.models.test-response');
  assert.equal(job.event.job_id,undefined);assert.equal(job.event.status,undefined);
  assert.equal(release.event.kind,undefined);assert.equal(release.event.data.registry,'future-registry');
  assert.equal(reply.event.channel,undefined);
  for(let i=0;i<100&&bus.query().events.length<2;i++)await new Promise(r=>setTimeout(r,20));
  assert.equal(bus.query().events.length,2);
  assert.equal(bus.query({sourcePrefix:'reply/'}).events.length,0);
  const filter=[[{path:'event.source.id',op:'prefixSegment',value:'job/42/task/a/b/execution/'}]];
  assert.equal(bus.query({filter}).events.length,1);
  assert.equal(bus.query({filter:[[ {path:'event.source.id',op:'prefixSegment',value:'job/42/task/a/'} ]]}).events.length,0);
  assert.throws(()=>bus.query({filter:[[{path:'event.type',op:'eval',value:'x'}]]}));
  assert.ok(recordingBindings(config).every(x=>!x.includes('.reply.')));
});
test('standalone generic bus requires no configured domain routes',t=>{
  const config={...fixture(t),routing:{routes:[],fallbackPrefix:'{configured}.generic'}};
  const v=routeEvent({type:'sample.event',source:'job/custom',data:{x:1}},config);
  assert.ok(v.subject.startsWith(config.subjectPrefix+'.generic.'));
  assert.deepEqual(v.event,{type:'sample.event',source:{id:'job/custom'},data:{x:1}});
});

test('runtime config discovery and invalid saved JSON fail closed',t=>{
  const config=fixture(t),env={EVENTS_BUS_DATA_DIR:config.dataDir};
  writeRuntimeConfig(config,env);
  const saved=resolveRuntimeConfig(env);
  assert.equal(saved.subjectPrefix,config.subjectPrefix);
  assert.deepEqual(saved.routing,config.routing);
  assert.equal(saved.natsUrl,config.natsUrl);
  for(const raw of ['{bad','[]','null']){
    fs.writeFileSync(path.join(config.dataDir,'runtime.json'),raw);
    assert.throws(()=>resolveRuntimeConfig(env),/Invalid Events Bus runtime config/);
  }
});
test('durable history survives memory-window eviction and keeps receipt timestamp',t=>{
  const config=fixture(t),source='quiet/item';
  const target={cursor:1,subject:'test.quiet',event:{type:'quiet.changed',source:{id:source},data:{value:1},event_id:'first'}};
  const rows=[JSON.stringify(target)];
  for(let i=0;i<MAX_MEMORY_EVENTS;i++)rows.push(JSON.stringify({cursor:i+2,subject:'test.noisy',event:{type:'noise.changed',source:{id:'noise/item'},data:{}}}));
  fs.writeFileSync(config.historyFile,rows.join('\n')+'\n');
  const bus=new EventsBusCore({config});
  assert.equal(bus.events.some(row=>row.event.source?.id===source),false);
  assert.equal(bus.query({source}).events[0].cursor,1);
  const bogus='2000-01-01T00:00:00Z';
  const raw={type:'quiet.changed',source:{id:source},data:{},timestamp:bogus};
  const env=transportEnvelope(raw);
  assert.notEqual(env.timestamp,bogus);
  bus.appendEvent('test.quiet',raw);
  assert.notEqual(bus.query({source,order:'desc',limit:1}).events[0].event.timestamp,bogus);
});

test('failed durable append never creates a false cursor or dedup receipt',t=>{
  const config=fixture(t),bus=new EventsBusCore({config});
  const event=transportEnvelope(routeEvent({type:'sample.changed',source:'sample/id',data:{}},config).event);
  fs.mkdirSync(config.historyFile);
  assert.throws(()=>bus.appendEvent('test.sample',event));
  assert.equal(bus.nextCursor,1);
  assert.equal(bus.seenEventIds.has(event.event_id),false);
  assert.equal(bus.events.length,0);
  fs.rmdirSync(config.historyFile);
  assert.equal(bus.appendEvent('test.sample',event).cursor,1);
});
test('recording rejects mismatched routed sources even with legacy extensions; route conflicts fail closed',t=>{
  const config=fixture(t);
  const {subject,event}=routeEvent({type:'task.completed',source:'job/42/task/1/execution/lease',data:{}},config);
  assert.equal(acceptsRecord(subject,{...event,job_id:'42'},config),true);
  assert.equal(acceptsRecord(subject.replace('.42.','.43.'),{...event,job_id:'43'},config),false);
  assert.equal(acceptsRecord(subject,{type:'task.completed',source:{id:'reply/models/request-123'},data:{},job_id:'42'},config),false);
  const conflict={...config,routing:{...config.routing,routes:[...config.routing.routes,config.routing.routes[0]]}};
  assert.throws(()=>routeEvent({type:'sample.changed',source:'sample/id',data:{}},conflict),/ambiguous/);
});
