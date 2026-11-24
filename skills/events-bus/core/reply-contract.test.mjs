import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createEventsBusCore} from './events-core.mjs';
import{expandPublishEvent}from './publish-envelope.mjs';
import{parseReplySource,validateReplyEvent,replySubject,replyChannelSubject}from'./reply-contract.mjs';
import{listenReplyEvents}from'./reply-listener.mjs';
import{resolveRuntimeConfig}from'./config.mjs';

const rid='resp_'+'a'.repeat(40);
const source=`reply/models/${rid}`;

test('reply contract uses existing publish type/source/data, distinct subjects and explicit terminal',()=>{
  const config={...resolveRuntimeConfig(),subjectPrefix:'test.replies.job'};
  assert.deepEqual(parseReplySource(source),{channel:'models',request_id:rid});
  for(const channel of ['models','voice','test-reply','family-tutor']){
    const id='run_12345';
    assert.equal(replySubject(config,channel,id),`test.replies.reply.${channel}.${id}`);
    assert.equal(replyChannelSubject(config,channel),`test.replies.reply.${channel}.>`);
    assert.equal(expandPublishEvent({type:'reply.completed',source:`reply/${channel}/${id}`}).channel,channel);
  }
  const txt=expandPublishEvent({type:'reply.text',source,data:{text:'First segment',seq:1}});
  assert.deepEqual(txt,{kind:'reply',type:'reply.text',source:{id:source},channel:'models',request_id:rid,data:{text:'First segment',seq:1}});
  assert.equal(expandPublishEvent({type:'reply.heartbeat',source}).type,'reply.heartbeat');
  assert.equal(expandPublishEvent({type:'reply.failed',source,data:{error:'unsupported'}}).type,'reply.failed');
  assert.deepEqual(Object.keys(expandPublishEvent({type:'task.completed',source:'job/12/task/a/execution/b'})).sort(),['data','job_id','message','source','status','task_id','type','visibility'].sort());
});

test('reply events reject spoofed channel/source, malformed payload and implicit completion',()=>{
  const bad=[
    ['reply.text',source,{}],['reply.text',source,{text:'x'}],['reply.text',source,{text:'x',seq:0}],
    ['reply.text',source,{text:'x',seq:1,completed:true}],['reply.completed',source,{text:'x'}],
    ['reply.failed',source,{}],['reply.heartbeat',source,{text:'secret'}],
    ['reply.completed','reply/models/x',{}],['reply.text','reply/unknown!channel/run_12345',{text:'x',seq:1}],
    ['reply.text','job/1/task/t/execution/z',{text:'x',seq:1}],
    ['task.completed',source,{}],
  ];
  for(const [type,src,data]of bad)assert.throws(()=>validateReplyEvent({type,source:src,data}),Error,`${type} ${src}`);
  assert.throws(()=>expandPublishEvent({type:'reply.text',source:'reply/models/'+rid,data:{text:'',seq:1}}));
});

test('real NATS listener routes exact reply channel without forwarding to Relay Job subscriber',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'neo-reply-events-test-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const config={...resolveRuntimeConfig({EVENTS_BUS_DATA_DIR:dir}),subjectPrefix:'test.neo.reply.integration'+Math.floor(Math.random()*100000)+'.job'};
  const core=createEventsBusCore({config,name:'test-publisher'});
  const received={models:[],voice:[],chat:[]};
  const listeners=[
    listenReplyEvents({channel:'models',config,onEvent:e=>received.models.push(e)}),
    listenReplyEvents({channel:'voice',config,onEvent:e=>received.voice.push(e)}),
    listenReplyEvents({channel:'test-reply',config,onEvent:e=>received.chat.push(e)}),
  ];
  t.after(async()=>{await Promise.all(listeners.map(l=>l.close()));await core.close()});
  for(const l of listeners)await l.start();
  const publish=async(type,src,data)=>core.publish(expandPublishEvent({type,source:src,data}));
  await publish('reply.text',source,{text:'a',seq:1});
  await publish('reply.text','reply/voice/voice12345',{text:'voice fragment',seq:1});
  await publish('reply.completed',source,{});
  await core.publish(expandPublishEvent({type:'task.started',source:'job/123/task/probe/execution/xyz',data:{message:'job event'}}));
  const stop=Date.now()+2000;
  while(Date.now()<stop&&(received.models.length<2||received.voice.length<1))await new Promise(r=>setTimeout(r,10));
  assert.deepEqual(received.models.map(e=>e.type),['reply.text','reply.completed']);
  assert.deepEqual(received.voice.map(e=>e.type),['reply.text']);
  assert.deepEqual(received.chat,[]);
  assert.equal(received.models[0].data.text,'a');
});
