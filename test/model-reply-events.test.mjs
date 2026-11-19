import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {ModelStore}from '../services/models/store.mjs';
import{applyModelReplyEvent,createModelReplyListener}from'../services/models/reply-events.mjs';
import{createEventsBusCore}from'../skills/events-bus/core/events-core.mjs';
import{expandPublishEvent}from'../skills/events-bus/core/publish-envelope.mjs';
import{resolveRuntimeConfig}from'../skills/events-bus/core/config.mjs';

const rid='resp_'+'a'.repeat(40);
const source='reply/models/'+rid;
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'models-reply-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const store=new ModelStore(dir);const sid='sess_'+'b'.repeat(40);store.putSession({id:sid,status:'awaiting',lastResponseId:rid,history:[],lastInput:[{role:'user',text:'a test',images:[]}],threadId:'thread1'});store.putResponse({id:rid,sessionId:sid,status:'in_progress',output:[],reports:[]});return{store,dir};}
const event=(type,data={})=>expandPublishEvent({type,source,data});

test('model reply listener performs multi-report, heartbeat, explicit completion, and rejects late events',t=>{
 const{store}=fixture(t);
 assert.equal(applyModelReplyEvent(store,event('reply.heartbeat')).heartbeat_count,1);
 assert.equal(store.response(rid).status,'in_progress');
 applyModelReplyEvent(store,event('reply.text',{seq:1,text:'hello'}));
 assert.equal(applyModelReplyEvent(store,event('reply.text',{seq:1,text:'hello'})).duplicate,true);
 assert.throws(()=>applyModelReplyEvent(store,event('reply.text',{seq:3,text:'jump'})),/out-of-order/);
 assert.throws(()=>applyModelReplyEvent(store,event('reply.text',{seq:1,text:'different'})),/conflicting/);
 applyModelReplyEvent(store,event('reply.text',{seq:2,text:'world'}));
 assert.deepEqual(store.response(rid).reports,['hello','world']);
 assert.equal(store.response(rid).status,'in_progress');
 applyModelReplyEvent(store,event('reply.completed'));
 assert.equal(store.response(rid).status,'completed');
 assert.equal(store.response(rid).output[0].content[0].text,'hello\nworld');
 assert.equal(store.session('sess_'+'b'.repeat(40)).status,'idle');
 assert.throws(()=>applyModelReplyEvent(store,event('reply.text',{seq:3,text:'late'})),/terminal/);
 assert.equal(applyModelReplyEvent(store,event('reply.completed')).status,'completed');
});

test('real NATS reply event listener updates ModelStore only for the expected model response',async t=>{
 const{store,dir}=fixture(t);
 const config={...resolveRuntimeConfig({EVENTS_BUS_DATA_DIR:dir}),subjectPrefix:'test.neo.reply.models'+Date.now()+'.job'};
 const errors=[];const listener=createModelReplyListener(store,{config,onError:e=>errors.push(e)});
 const publisher=createEventsBusCore({config,name:'model-reply-test'});
 t.after(async()=>{await listener.close();await publisher.close()});
 await listener.start();
 for(const x of [event('reply.text',{seq:1,text:'First report'}),event('reply.text',{seq:2,text:'Second report'}),event('reply.completed')])await publisher.publish(x);
 const stop=Date.now()+2000;
 while(Date.now()<stop&&store.response(rid).status!=='completed')await new Promise(r=>setTimeout(r,10));
 assert.equal(store.response(rid).status,'completed');
 assert.deepEqual(store.response(rid).reports,['First report','Second report']);
 assert.deepEqual(errors,[]);
});
