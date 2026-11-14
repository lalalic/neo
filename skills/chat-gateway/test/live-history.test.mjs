import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveHistory} from '../core/live-history.mjs';

const response = body=>({ok:true,json:async()=>body});
test('Event Bus catchup cursor validates bounded, ordered Job history',async()=>{
 const calls=[];
 const history=createLiveHistory({apiUrl:'http://127.0.0.1:4223',fetcher:async url=>{
   const u=new URL(url);calls.push(u);
   if(u.searchParams.get('order')==='desc')return response({job_id:'629',events:[{cursor:107}],next_cursor:107});
   return response({job_id:'629',events:[{cursor:108,event:{job_id:'629',type:'task.completed'}},
     {cursor:109,event:{job_id:'629',type:'task.started'}}],next_cursor:109});
 }});
 assert.equal(await history.latestCursor('629'),107);
 const page=await history.after('629',107);
 assert.equal(page.next_cursor,109);
 assert.equal(page.events.length,2);
 assert.equal(calls[1].searchParams.get('after'),'107');
 assert.equal(calls[1].searchParams.get('order'),'asc');
});

test('Rejects forged, nonadvancing, wrong-Job and off-host history',async()=>{
 assert.throws(()=>createLiveHistory({apiUrl:'http://example.com:4223'}),/loopback/);
 await assert.rejects(createLiveHistory({apiUrl:'http://127.0.0.1:4223',
   fetcher:async()=>response({job_id:'999',events:[],next_cursor:0})}).after('629',0),/invalid data|Invalid live history response/i);
 await assert.rejects(createLiveHistory({apiUrl:'http://127.0.0.1:4223',
   fetcher:async()=>response({job_id:'629',events:[{cursor:10,event:{job_id:'629'}}],next_cursor:9})}).after('629',9),/cursor/i);
 await assert.rejects(createLiveHistory({apiUrl:'http://127.0.0.1:4223',
   fetcher:async()=>response({job_id:'629',events:[],next_cursor:100})}).after('629',9),/cursor/);
});
