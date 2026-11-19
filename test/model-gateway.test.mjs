import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ModelStore} from '../services/models/store.mjs';
import {ResponseEngine,streamResponse} from '../services/models/responses.mjs';
import {createModelServer} from '../services/models/server.mjs';
import {reportCompleted,reportText,reportComplete,reportFailed,reportLargeFile} from '../services/models/report.mjs';
import {handleMcp,invokeReport,TOOL} from '../services/models/mcp.mjs';
import {createTurnPrompt} from '../services/models/prompt.mjs';

const token='development-model-test-token-0123456789abcdef';
function fixture(t){
  const dir=mkdtempSync(join(tmpdir(),'neo-generic-models-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const calls=[];
  let n=0;
  const store=new ModelStore(dir);
  const compose=(prompt,context)=>context?`<top-instructions>\n${context}\n</top-instructions>\n\n${prompt}`:prompt;
  const transport={
    async newThread(prompt,context){calls.push(['newThread',compose(prompt,context),context,prompt]);return {thread_id:'thread-'+calls.filter(x=>x[0]==='newThread').length,thread_url:'https://chatgpt.com/c/thread-'+calls.filter(x=>x[0]==='newThread').length,status:'submitted'};},
    async newTurn(threadId,prompt,files,responseId,project,context){calls.push(['newTurn',threadId,compose(prompt,context),files,responseId,project,context,prompt]);return {status:'submitted',thread_id:threadId,queue_id:'queued_'+responseId};},
    async waitForResult(id,writeStore){
      calls.push(['waitForResult',id]);
      const output=n++===0?'First reply':'Second reply';
      reportText(writeStore,id,output);
      const completed=reportComplete(writeStore,id);
      return completed.output[0].content[0].text;
    },
  };
  return {dir,store,transport,calls};
}
const texts=(role,text)=>({role,content:[{type:'input_text',text}]});
const startBody={model:'neo',store:false,stream:true,input:[texts('system','agent-specific instructions come from client'),texts('user','hello')]};
const nextBody={...startBody,input:[...startBody.input,texts('assistant','First reply'),texts('user','continue')]};

test('one newThread, subsequent newTurn reuses thread after process restart, no history replay',async t=>{
  const {store,transport,calls}=fixture(t);
  const one=await new ResponseEngine({store,transport}).run(startBody);
  assert.equal(one.status,'completed');
  assert.equal(one.output[0].content[0].text,'First reply');
  assert.deepEqual(calls.map(c=>c[0]),['newThread','waitForResult']);
  const firstPrompt=calls[0][1];
  assert.match(firstPrompt,/Neo model request:/);
  assert.match(firstPrompt,/reply\.text/);
  assert.doesNotMatch(firstPrompt,/agent-specific instructions come from client/);
  assert.doesNotMatch(firstPrompt,/\[SYSTEM\]|\[DEVELOPER\]/);
  assert.match(firstPrompt,/\[USER\]/);
  assert.doesNotMatch(firstPrompt,/Read .*\.request\.json/);
  assert.doesNotMatch(firstPrompt,/ToyAlive|VLM|toy3d-vlm-report|qili2 PRIVATE/);
  const two=await new ResponseEngine({store:new ModelStore(store.base),transport}).run(nextBody);
  assert.equal(two.output[0].content[0].text,'Second reply');
  assert.deepEqual(calls.map(c=>c[0]),['newThread','waitForResult','newTurn','waitForResult']);
  assert.equal(calls[2][1],'thread-1');
  assert.match(calls[2][2],/\[USER\]\ncontinue/);
  assert.doesNotMatch(calls[2][2],/agent-specific instructions come from client|hello|First reply/);
  const repeat=await new ResponseEngine({store,transport}).run(nextBody);
  assert.deepEqual(repeat,two,'exact history retry reuses prior completed response');
  assert.equal(calls.length,4);
  const sessions=store.listSessions();
  assert.equal(sessions.length,1);
  assert.equal(sessions[0].threadId,'thread-1');
  assert.equal(sessions[0].history.length,5);
});

test('explicit previous_response_id routes one-turn input to same thread',async t=>{
  const {store,transport,calls}=fixture(t);
  const first=await new ResponseEngine({store,transport}).run(startBody);
  const second=await new ResponseEngine({store,transport}).run({model:'neo',previous_response_id:first.id,input:[texts('user','one more')]});
  assert.equal(second.status,'completed');
  assert.equal(calls.at(-2)[1],'thread-1');
  assert.match(calls.at(-2)[2],/Neo model request:/);
});

test('explicit metadata.session_id binds even when only newest user message is submitted',async t=>{
  const {store,transport,calls}=fixture(t);
  await new ResponseEngine({store,transport}).run({...startBody,metadata:{session_id:'codex_session_1234'}});
  await new ResponseEngine({store,transport}).run({model:'neo',metadata:{session_id:'codex_session_1234'},input:[texts('user','followup only')]});
  assert.equal(calls.filter(x=>x[0]==='newThread').length,1);
  assert.equal(calls.at(-2)[1],'thread-1');
});

test('no ambiguous Thread rebind when histories collide',async t=>{
  const {store,transport}=fixture(t);
  const existing=store.create([{role:'user',text:'hello',images:[]}]);
  store.putSession({...existing,id:'sess_'+'a'.repeat(40),status:'idle'});
  store.putSession({...existing,id:'sess_'+'b'.repeat(40),status:'idle'});
  await assert.rejects(()=>new ResponseEngine({store,transport}).run({model:'neo',input:'hello'}),/ambiguous/);
});

test('uncertain browser outcome never retries the same submitted turn automatically',async t=>{
  const {store,transport}=fixture(t);
  transport.waitForResult=async()=>{throw Error('model completion unconfirmed')};
  await assert.rejects(()=>new ResponseEngine({store,transport}).run(startBody),/unconfirmed/);
  const records=store.listSessions();
  assert.equal(records[0].status,'uncertain');
  assert.equal(store.response(records[0].lastResponseId).status,'failed');
  await assert.rejects(()=>new ResponseEngine({store,transport}).run(startBody),/unconfirmed submission/);
});

test('SSE responses include completed output_text and end markers',async t=>{
  const {store,transport}=fixture(t);
  const response=await new ResponseEngine({store,transport}).run(startBody);
  const s=streamResponse(response);
  for(const type of ['response.created','response.in_progress','response.output_item.added','response.output_text.delta','response.output_item.done','response.completed'])assert.match(s,new RegExp('event: '+type.replace('.','\\.')));
  assert.match(s,/First reply/);
});

test('HTTP generic /v1/models, streaming, async polling and chat completion',async t=>{
  const {store,transport}=fixture(t);
  const {server}=createModelServer({token,store,transport});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(()=>new Promise(r=>server.close(r)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const headers={'Content-Type':'application/json',Authorization:'Bearer '+token};
  const post=(path,body,auth=true)=>fetch(base+path,{method:'POST',headers:auth?headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await post('/v1/responses',startBody,false)).status,401);
  const catalog=await fetch(base+'/v1/models',{headers});
  assert.equal(catalog.status,200);assert.deepEqual((await catalog.json()).data.map(x=>x.id),['neo']);
  const streaming=await post('/v1/responses',startBody);
  assert.equal(streaming.status,200);
  const stream=await streaming.text();
  assert.match(stream,/response.completed/);
  const asyncResponse=await post('/v1/responses',{model:'neo',input:[texts('user','different topic')],stream:false});
  assert.equal(asyncResponse.status,202);
  const pending=await asyncResponse.json();
  assert.match(pending.id,/^resp_[a-f0-9]{40}$/);
  let polled;
  for(let i=0;i<30;i++){
    const resp=await fetch(base+'/v1/responses/'+pending.id,{headers});
    polled=await resp.json();if(polled.status==='completed')break;
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert.equal(polled.status,'completed');
  const chat=await post('/v1/chat/completions',{model:'neo',messages:[texts('user','chat API')]});
  assert.equal(chat.status,200);
  assert.equal((await chat.json()).object,'chat.completion');
});

test('image input is materialized privately for generic Neo model request',async t=>{
  const {store,transport,calls}=fixture(t);
  const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(100)]).toString('base64');
  const body={model:'neo',input:[{role:'user',content:[{type:'input_text',text:'describe image'},{type:'input_image',image_url:'data:image/png;base64,'+png}]}]};
  const result=await new ResponseEngine({store,transport}).run(body);
  assert.equal(result.status,'completed');
  assert.equal(calls[0][0],'newThread');
  assert.equal(calls[1][0],'waitForResult');
  const imageRef=calls[0][1].match(/\[image 1\] (.*image-[a-f0-9]+\.png)/)[1];
  assert.equal(readFileSync(imageRef).subarray(0,4).toString('hex'),'89504e47');
  assert.doesNotMatch(calls[0][1],/Read .*\.request\.json/);
  assert.ok(!JSON.stringify(store.listSessions()).includes(png),'base64 photos are never persisted in session journal');
});

test('generic model report CLI completes an async response from a separate process',async t=>{
  const {dir,store}=fixture(t);
  const id='resp_'+'a'.repeat(40);
  store.putResponse({id,sessionId:'sess_'+'b'.repeat(40),object:'response',model:'neo',status:'in_progress',created_at:0,output:[]});
  const requests=join(dir,'requests');
  const {mkdirSync}=await import('node:fs');mkdirSync(requests,{recursive:true});
  const file=join(requests,id+'.output.json');
  writeFileSync(file,JSON.stringify({output:'CLI_OK'}));
  const {spawnSync}=await import('node:child_process');
  const cli=new URL('../services/models/report.mjs',import.meta.url).pathname;
  const env={...process.env,NEO_MODELS_STATE_DIR:dir};
  const first=spawnSync(process.execPath,[cli,'completed',id,file],{env,encoding:'utf8'});
  assert.equal(first.status,0,first.stderr);
  assert.equal(store.response(id).status,'completed');
  assert.equal(store.response(id).output[0].content[0].text,'CLI_OK');
  const again=spawnSync(process.execPath,[cli,'completed',id,file],{env,encoding:'utf8'});
  assert.equal(again.status,0,'same receipt is idempotent');
  const wrong=spawnSync(process.execPath,[cli,'completed',id,'/etc/hosts'],{env,encoding:'utf8'});
  assert.notEqual(wrong.status,0,'refuse result file from outside the request');
});

test('model WebHelm transport invokes newThread once, newTurn with same thread ID and stable idempotency key',async t=>{
  const {WebHelmTransport}=await import('../services/models/webhelm.mjs');
  const dir=mkdtempSync(join(tmpdir(),'neo-webhelm-config-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const calls=[];
  const fake=async(binary,args)=>{
    const action=args[3];
    const config=JSON.parse(readFileSync(args[args.indexOf('--config')+1],'utf8'));
    calls.push({binary,action,config,auto:args.includes('--auto-session')});
    if(action==='new-thread')return {result:{ok:true,value:{status:'submitted',thread_id:'thread-xyz',thread_url:'https://chatgpt.com/c/thread-xyz'}}};
    if(action==='new-turn')return {result:{ok:true,status:'submitted',thread_id:'thread-xyz',queue_id:'queue-abc'}};
    throw Error('unexpected CLI action');
  };
  const transport=new WebHelmTransport({tempDir:dir,binary:'/example/webhelm',exec:fake,holdSession:false,appName:'',serializeNewThread:false});
  const start=await transport.newThread('generic prompt');
  assert.equal(start.thread_id,'thread-xyz');
  await transport.newTurn(start.thread_id,'follow up',[],'resp_'+'f'.repeat(40));
  assert.deepEqual(calls.map(x=>x.action),['new-thread','new-turn']);
  assert.equal(calls[0].auto,true);
  assert.equal(calls[1].auto,false,'durable new-turn queue has no browser Session');
  assert.equal(calls[1].config.thread_id,'thread-xyz');
  assert.equal(calls[1].config.idempotency_key,'resp_'+'f'.repeat(40));
  assert.equal(calls[0].config.enforcement_context,'');
  assert.equal(calls[1].config.enforcement_context,'');
  calls.length=0;
  await transport.newThread('latest user','Always report completion');
  await transport.newTurn('thread-xyz','follow up',[],'resp_'+'e'.repeat(40),null,'Always report completion');
  assert.deepEqual(calls.map(x=>x.config.enforcement_context),['Always report completion','Always report completion']);
});

test('legacy Rodin route and old response GET pass through generic model API',async t=>{
  const {store,transport}=fixture(t);
  const {createServer}=await import('node:http');
  let last;
  const upstream=createServer(async(req,res)=>{
    const body=[];for await(const chunk of req)body.push(chunk);
    last={method:req.method,path:req.url,authorization:req.headers.authorization,body:Buffer.concat(body).toString('utf8')};
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:true,path:req.url}));
  });
  await new Promise(ok=>upstream.listen(0,'127.0.0.1',ok));
  t.after(()=>new Promise(ok=>upstream.close(ok)));
  const {server}=createModelServer({token,store,transport,legacyOrigin:`http://127.0.0.1:${upstream.address().port}`});
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
  t.after(()=>new Promise(ok=>server.close(ok)));
  const base=`http://127.0.0.1:${server.address().port}`,headers={Authorization:'Bearer '+token};
  const rodin=await fetch(base+'/api/v2/rodin',{method:'POST',headers:{...headers,'Content-Type':'application/octet-stream'},body:'raw'});
  assert.equal(rodin.status,200);assert.equal(last.body,'raw');
  assert.equal(last.authorization,headers.Authorization);
  const oldId='resp_'+'a'.repeat(40);
  const previous=await fetch(base+'/v1/responses/'+oldId,{headers});
  assert.equal(previous.status,200);assert.equal(last.path,'/v1/responses/'+oldId);
  assert.equal((await previous.json()).ok,true);
});

test('previous_response_id with full history still submits only the new suffix',async t=>{
  const {store,transport,calls}=fixture(t);
  const first=await new ResponseEngine({store,transport}).run(startBody);
  const full={...nextBody,previous_response_id:first.id};
  await new ResponseEngine({store,transport}).run(full);
  const prompt=calls.find(x=>x[0]==='newTurn')[2];
  assert.match(prompt,/\[USER\]\ncontinue/);
  assert.doesNotMatch(prompt,/Read .*\.request\.json/);
});

test('replaying an identical completed POST does not create another Thread',async t=>{
  const {store,transport,calls}=fixture(t);
  const engine=new ResponseEngine({store,transport});
  const original=await engine.run({...startBody,stream:false});
  let started=null;
  const replay=await engine.run({...startBody,stream:false},{onStarted:r=>{started=r}});
  assert.equal(replay.id,original.id);
  assert.equal(started.id,original.id);
  assert.equal(calls.filter(x=>x[0]==='newThread').length,1);
});

test('Responses SSE sequence numbers are monotonic',async t=>{
  const {store,transport}=fixture(t);
  const result=await new ResponseEngine({store,transport}).run(startBody);
  const nums=streamResponse(result).split('\n').filter(x=>x.startsWith('data: ')).map(x=>JSON.parse(x.slice(6)).sequence_number);
  assert.deepEqual(nums,[...nums.keys()]);
});


test('Codex client_version receives model metadata; public list keeps OpenAI shape',async t=>{
  const {store,transport}=fixture(t);
  const {server}=createModelServer({token,store,transport});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url=`http://127.0.0.1:${server.address().port}/v1/models`;
  const headers={Authorization:'Bearer '+token};
  const publicModels=await (await fetch(url,{headers})).json();
  assert.equal(publicModels.object,'list');
  assert.deepEqual(publicModels.data.map(m=>m.id),['neo']);
  assert.equal(publicModels.models,undefined);
  const codex=await (await fetch(url+'?client_version=0.165.0',{headers})).json();
  assert.deepEqual(codex.models.map(m=>m.slug),['neo']);
  assert.equal(codex.models[0].display_name,'Neo');
  assert.equal(codex.models[0].shell_type,'disabled');
  assert.match(codex.models[0].base_instructions,/system, developer and user/);
  assert.ok(Array.isArray(codex.models[0].supported_reasoning_levels));
  assert.equal(codex.data,undefined);
  assert.equal((await fetch(url+'?client_version=0.165.0')).status,401);
});

test('small messages inline and no input/output files; report tool context on every turn',async t=>{
  const {store,transport,calls}=fixture(t);
  await new ResponseEngine({store,transport}).run(startBody);
  const first=calls[0][1];
  assert.match(first,/^<top-instructions>[\s\S]*<\/top-instructions>/);
  assert.match(first,/\[USER\]\nhello/);
  assert.doesNotMatch(first,/\[SYSTEM\]|\[DEVELOPER\]|agent-specific instructions come from client/);
  assert.match(first,/reply\.text/);
  const id=first.match(/Neo model request: (resp_[0-9a-f]{40})/)[1];
  assert.match(first,new RegExp(id));
  assert.equal(readFileSync(store.base+'/sessions/'+store.listSessions()[0].id+'.json','utf8').includes('First reply'),true);
  const {existsSync}=await import('node:fs');
  assert.equal(existsSync(store.base+'/requests/'+id+'.request.json'),false);
  assert.equal(existsSync(store.base+'/requests/'+id+'.output.txt'),false);
  await new ResponseEngine({store,transport}).run(nextBody);
  assert.match(calls[2][2],/reply\.text/);
  assert.match(calls[2][2],/\[USER\]\ncontinue/);
  assert.doesNotMatch(calls[2][2],/agent-specific instructions come from client|\[SYSTEM\]/);
});

test('long user inputs stay fully inline and WebHelm transports unchanged',async t=>{
  const {store,transport,calls}=fixture(t);
  const payload='Long conversation: '+('中文内容 and code const x = 1; '.repeat(4000));
  await new ResponseEngine({store,transport}).run({model:'neo',input:[texts('user',payload)]});
  const prompt=calls[0][1];
  assert.ok(prompt.includes(payload));
  assert.match(prompt,/reply\.text/);
  assert.doesNotMatch(prompt,/\.request\.json|\.output\.txt|READ |Read /);
  assert.equal(prompt.match(/Long conversation:/g)?.length,1);
  const {existsSync}=await import('node:fs');
  assert.equal(existsSync(join(store.base,'requests')),false);
});

test('mcp.models chat_report supports multiple reports and requires an explicit completed message',async t=>{
  const {store}=fixture(t);
  const make=id=>store.putResponse({id,sessionId:'sess_'+('a'.repeat(40)),object:'response',model:'neo',status:'in_progress',created_at:0,output:[]});
  const id='resp_'+'a'.repeat(40);make(id);
  const call=(n,args)=>handleMcp({id:n,method:'tools/call',params:{name:'chat_report',arguments:{response_id:id,...args}}},store);
  assert.equal(call(0,{completed:true}).result.isError,true,'cannot complete with no reports');
  assert.equal(call(1,{text:'HELLO'}).result.isError,false);
  assert.equal(store.response(id).status,'in_progress','one report does not end the turn');
  assert.equal(call(2,{text:'WORLD'}).result.isError,false);
  assert.equal(store.response(id).status,'in_progress','two reports do not end the turn');
  assert.deepEqual(store.response(id).reports,['HELLO','WORLD']);
  assert.equal(store.response(id).output[0].content[0].text,'HELLO\nWORLD');
  assert.equal(call(3,{completed:false}).result.isError,true);
  assert.equal(call(4,{completed:true}).result.isError,false);
  assert.equal(store.response(id).status,'completed');
  assert.equal(call(5,{completed:true}).result.isError,false,'terminal acknowledgement can be retried');
  assert.equal(call(6,{text:'AFTER'}).result.isError,true,'reports after completion are forbidden');
  const hugeId='resp_'+'b'.repeat(40);make(hugeId);
  const largeText='中文'.repeat(35000);
  const large=handleMcp({id:7,method:'tools/call',params:{name:'chat_report',arguments:{response_id:hugeId,text:largeText}}},store);
  assert.equal(large.result.isError,false);
  assert.equal(store.response(hugeId).output[0].content[0].text,largeText);
  assert.equal(store.response(hugeId).status,'in_progress');
  assert.equal(TOOL.inputSchema.properties.text.maxLength,undefined);
  assert.equal(TOOL.inputSchema.properties.file,undefined);
  assert.equal(handleMcp({id:8,method:'tools/call',params:{name:'chat_report',arguments:{response_id:hugeId,file:'/tmp/file'}}},store).result.isError,true);
  const failId='resp_'+'c'.repeat(40);make(failId);
  assert.equal(handleMcp({id:9,method:'tools/call',params:{name:'chat_report',arguments:{response_id:failId,error:'Actual model failure'}}},store).result.isError,false);
  assert.equal(store.response(failId).status,'failed');
  assert.equal(handleMcp({id:10,method:'tools/list'},store).result.tools[0].name,'chat_report');
});

test('MCP stdio lifecycle advertises exactly one model response tool',async t=>{
  const {spawn}=await import('node:child_process');
  const child=spawn(process.execPath,[new URL('../services/models/mcp.mjs',import.meta.url).pathname],{
    env:{...process.env,NEO_MODELS_STATE_DIR:mkdtempSync(join(tmpdir(),'neo-model-mcp-'))},stdio:['pipe','pipe','pipe']});
  const answers=[];
  child.stdout.on('data',chunk=>{for(const line of chunk.toString().split('\n'))if(line.trim())try{answers.push(JSON.parse(line))}catch{}});
  child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{clientInfo:{name:'test',version:'1'},capabilities:{}}})+'\n');
  child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/list'})+'\n');
  const end=Date.now()+3000;
  while(Date.now()<end&&answers.length<2)await new Promise(r=>setTimeout(r,20));
  child.kill('SIGTERM');
  assert.deepEqual(answers.map(x=>x.id),[1,2]);
  assert.equal(answers[1].result.tools[0].name,'chat_report');
  assert.equal(answers[1].result.tools.length,1);
});


test('input text preserves exact leading and trailing whitespace',async t=>{
  const {store,transport,calls}=fixture(t);
  const prompt='  preserve leading and trailing spaces  \n  code snippet: x = 1;  ';
  await new ResponseEngine({store,transport}).run({model:'neo',input:[texts('user',prompt)]});
  assert.ok(calls[0][1].includes('[USER]\n'+prompt+'\n[/USER]'));
});

test('live Responses SSE forwards multiple text reports before explicit completion and closes exactly once',async t=>{
  const {store}=fixture(t);
  const transport={
    async newThread(){return {status:'submitted',thread_id:'test-thread',thread_url:'https://chatgpt.com/c/test-thread'}},
    async waitForResult(id){
      for(let i=0;i<300;i++){
        const state=store.response(id);
        if(state.status==='completed')return state.output.map(x=>x.content[0].text).join('\n');
        if(state.status==='failed')throw Error(state.error.message);
        await new Promise(r=>setTimeout(r,10));
      }
      throw Error('model completion timeout');
    },
  };
  const {server}=createModelServer({token,store,transport});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const headers={'Content-Type':'application/json',Authorization:'Bearer '+token};
  const resp=await fetch(base+'/v1/responses',{method:'POST',headers,body:JSON.stringify({model:'neo',input:'hello',stream:true})});
  assert.equal(resp.status,200);
  const reader=resp.body.getReader();
  const events=[];let input='',ended=false;
  const collecting=(async()=>{
    for(;;){
      const {done,value}=await reader.read();
      if(done){ended=true;break;}
      input+=new TextDecoder().decode(value);
      let pos;
      while((pos=input.indexOf('\n\n'))!==-1){
        const chunk=input.slice(0,pos);input=input.slice(pos+2);
        const data=chunk.split('\n').find(x=>x.startsWith('data: '));
        if(data)events.push(JSON.parse(data.slice(6)));
      }
    }
  })();
  const until=async predicate=>{
    for(let i=0;i<150;i++){
      const value=predicate();if(value)return value;
      await new Promise(r=>setTimeout(r,20));
    }
    throw Error('SSE event was not delivered before timeout');
  };
  const started=await until(()=>events.find(x=>x.type==='response.created'));
  const id=started.response.id;
  assert.equal(store.response(id).status,'in_progress');
  reportText(store,id,'First report');
  await until(()=>events.find(x=>x.type==='response.output_text.delta'&&x.delta==='First report'));
  assert.equal(store.response(id).status,'in_progress');
  assert.equal(ended,false);
  assert.equal(events.some(x=>x.type==='response.completed'),false);
  reportText(store,id,'Second report');
  await until(()=>events.find(x=>x.type==='response.output_text.delta'&&x.delta==='\nSecond report'));
  assert.equal(store.response(id).status,'in_progress');
  assert.equal(ended,false);
  assert.equal(events.some(x=>x.type==='response.completed'),false);
  const partial=await (await fetch(base+'/v1/responses/'+id,{headers})).json();
  assert.equal(partial.status,'in_progress');
  assert.deepEqual(partial.output.map(x=>x.content[0].text),['First report\nSecond report']);
  assert.equal(partial.reports,undefined,'internal report chunks stay private');
  reportComplete(store,id);
  await until(()=>events.find(x=>x.type==='response.completed'));
  await collecting;
  assert.equal(ended,true);
  assert.equal(events.filter(x=>x.type==='response.completed').length,1);
  assert.deepEqual(events.filter(x=>x.type==='response.output_text.delta').map(x=>x.delta),['First report','\nSecond report']);
  assert.equal(events.at(-1).type,'response.completed');
  assert.deepEqual(events.at(-1).response.output.map(x=>x.content[0].text),['First report\nSecond report']);
  const state=store.listSessions()[0];
  assert.equal(state.history.at(-1).text,'First report\nSecond report',
    'multi-report Turn must remain one assistant message for the next Codex Turn');
  assert.deepEqual(events.map(x=>x.sequence_number),events.map((_,i)=>i));
});

test('a text report followed by terminal failure emits response.failed instead of completed',async t=>{
  const {store}=fixture(t);
  const transport={
    async newThread(){return {status:'submitted',thread_id:'test-thread',thread_url:'https://chatgpt.com/c/test-thread'}},
    async waitForResult(id){
      for(let i=0;i<300;i++){
        const current=store.response(id);
        if(current.status==='failed')throw Error(current.error.message);
        if(current.status==='completed')return 'done';
        await new Promise(resolve=>setTimeout(resolve,10));
      }
      throw Error('timeout');
    },
  };
  const {server}=createModelServer({token,store,transport});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const headers={'Content-Type':'application/json',Authorization:'Bearer '+token};
  const url=`http://127.0.0.1:${server.address().port}`;
  const response=await fetch(url+'/v1/responses',{method:'POST',headers,body:JSON.stringify({model:'neo',input:'failure test',stream:true})});
  let eventStream='';
  const id=store.listSessions()[0].lastResponseId;
  reportText(store,id,'Partial report');
  reportFailed(store,id,'actual failed turn');
  eventStream=await response.text();
  assert.match(eventStream,/response.output_text.delta/);
  assert.match(eventStream,/Partial report/);
  assert.match(eventStream,/response.failed/);
  assert.doesNotMatch(eventStream,/event: response.completed/);
  assert.equal(store.response(id).status,'failed');
});


test('MCP stdio subprocess accepts multiple chat_report calls and a separate explicit completion',async t=>{
  const {spawn}=await import('node:child_process');
  const {dir,store}=fixture(t),id='resp_'+'d'.repeat(40);
  store.putResponse({id,sessionId:'sess_'+'f'.repeat(40),object:'response',model:'neo',status:'in_progress',created_at:0,output:[]});
  const child=spawn(process.execPath,[new URL('../services/models/mcp.mjs',import.meta.url).pathname],{
    env:{...process.env,NEO_MODELS_STATE_DIR:dir},stdio:['pipe','pipe','pipe']});
  t.after(()=>child.kill('SIGTERM'));
  const replies=[];let partial='';
  child.stdout.on('data',chunk=>{
    partial+=chunk.toString();let index;
    while((index=partial.indexOf('\n'))>=0){
      const line=partial.slice(0,index);partial=partial.slice(index+1);
      if(line.trim())replies.push(JSON.parse(line));
    }
  });
  const call=(n,args)=>child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:n,method:'tools/call',params:{name:'chat_report',arguments:{response_id:id,...args}}})+'\n');
  const until=async count=>{
    for(let i=0;i<150&&replies.length<count;i++)await new Promise(r=>setTimeout(r,10));
    if(replies.length<count)throw Error('MCP subprocess did not reply');
  };
  call(1,{text:'first'});await until(1);
  assert.equal(store.response(id).status,'in_progress');
  call(2,{text:'second'});await until(2);
  assert.deepEqual(store.response(id).reports,['first','second']);
  assert.equal(store.response(id).status,'in_progress');
  call(3,{completed:true});await until(3);
  assert.equal(store.response(id).status,'completed');
  assert.equal(store.response(id).output[0].content[0].text,'first\nsecond');
  assert.deepEqual(replies.map(x=>JSON.parse(x.result.content[0].text).report_count),[1,2,2]);
});

test('multi-report completion keeps exactly one assistant history item for subsequent Codex Turn',async t=>{
  const {store,transport,calls}=fixture(t);
  let count=0;
  transport.waitForResult=async(id,writeStore)=>{
    if(count++===0){
      reportText(writeStore,id,'section one');
      reportText(writeStore,id,'section two');
    }else reportText(writeStore,id,'continued');
    reportComplete(writeStore,id);
    return writeStore.response(id).output[0].content[0].text;
  };
  const engine=new ResponseEngine({store,transport});
  const first=await engine.run({model:'neo',input:[texts('user','question')],stream:true});
  assert.equal(first.output.length,1);
  assert.equal(first.output[0].content[0].text,'section one\nsection two');
  assert.equal(store.listSessions()[0].history.at(-1).text,'section one\nsection two');
  const second=await engine.run({model:'neo',stream:true,input:[
    texts('user','question'),texts('assistant','section one\nsection two'),texts('user','next')
  ]});
  assert.equal(second.status,'completed');
  assert.equal(second.output[0].content[0].text,'continued');
  assert.equal(calls.filter(x=>x[0]==='newThread').length,1);
  assert.equal(calls.filter(x=>x[0]==='newTurn').length,1);
  assert.equal(calls.find(x=>x[0]==='newTurn')[1],'thread-1');
});

test('Project-scoped model Turns still receive inline report contract and latest user only',async t=>{
  const {store,transport,calls}=fixture(t);
  const projectId='g-p-'+'a'.repeat(32);
  transport.projectId=projectId;
  transport.newTurn=async(threadId,prompt,files,responseId,project,context)=>{
    calls.push(['newTurn',threadId,`<top-instructions>\n${context}\n</top-instructions>\n\n${prompt}`,files,responseId,project,context]);
    return {status:'submitted',thread_id:threadId,queue_id:'queued_'+responseId};
  };
  transport.newThread=async (prompt,context)=>{
    calls.push(['newThread',`<top-instructions>\n${context}\n</top-instructions>\n\n${prompt}`]);
    return {status:'submitted',project_id:projectId,thread_id:'project-thread',
      thread_url:`https://chatgpt.com/g/${projectId}/c/project-thread`};
  };
  await new ResponseEngine({store,transport}).run(startBody);
  const start=calls.find(c=>c[0]==='newThread')[1];
  assert.match(start,/^<top-instructions>/);
  assert.match(start,/Neo model request: resp_[0-9a-f]{40}/);
  assert.doesNotMatch(start,/agent-specific instructions come from client/);
  assert.match(start,/reply\.text/);
  assert.doesNotMatch(start,/heartbeat/);
  assert.match(start,/completed/);
  const session=store.listSessions()[0];
  assert.equal(session.projectId,projectId);
  await new ResponseEngine({store,transport}).run(nextBody);
  const next=calls.find(c=>c[0]==='newTurn');
  assert.equal(next[1],'project-thread');
  assert.equal(next[5],projectId);
  assert.match(next[2],/^<top-instructions>/);
  assert.match(next[2],/Neo model request: resp_[0-9a-f]{40}/);
  assert.match(next[2],/\[USER\]\ncontinue/);
  assert.match(next[2],/reply\.text/);
  assert.doesNotMatch(next[2],/First reply|agent-specific/i);
});

test('non-Project sessions get identical top instructions with no Project dependency',async t=>{
  const {store,transport,calls}=fixture(t);
  transport.projectId=null;
  await new ResponseEngine({store,transport}).run(startBody);
  assert.match(calls[0][1],/reply\.text/);
  assert.match(calls[0][1],/reply\.completed/);
  assert.doesNotMatch(calls[0][1],/heartbeat/);
  assert.equal(store.listSessions()[0].projectId,null);
});

test('MCP heartbeat is non-terminal, does not add output, and keeps explicit completion mandatory',async t=>{
  const {store}=fixture(t);
  const id='resp_'+'b'.repeat(40);
  store.putResponse({id,sessionId:'sess_'+'c'.repeat(40),object:'response',model:'neo',status:'in_progress',created_at:0,output:[]});
  const call=(n,args)=>handleMcp({id:n,method:'tools/call',params:{name:'chat_report',arguments:{response_id:id,...args}}},store);
  assert.equal(TOOL.inputSchema.properties.heartbeat.const,true);
  assert.equal(call(1,{heartbeat:true}).result.isError,false);
  let state=store.response(id);
  assert.equal(state.status,'in_progress');
  assert.equal(state.heartbeat_count,1);
  assert.ok(state.last_activity_at>0);
  assert.deepEqual(state.output,[]);
  assert.equal(call(2,{heartbeat:false}).result.isError,true);
  assert.equal(call(3,{heartbeat:true,text:'bad'}).result.isError,true);
  assert.equal(call(4,{completed:true}).result.isError,true,'heartbeats cannot substitute for answer text');
  assert.equal(call(5,{text:'first'}).result.isError,false);
  assert.equal(call(6,{heartbeat:true}).result.isError,false);
  assert.equal(store.response(id).heartbeat_count,2);
  assert.equal(store.response(id).status,'in_progress');
  assert.equal(call(7,{completed:true}).result.isError,false);
  assert.equal(store.response(id).status,'completed');
  assert.equal(call(8,{heartbeat:true}).result.isError,true,'no heartbeats after completion');
});

test('heartbeat and text reports extend inactivity timeout but not absolute maximum',async t=>{
  const {store}=fixture(t);
  const {WebHelmTransport}=await import('../services/models/webhelm.mjs');
  const transport=new WebHelmTransport({tempDir:join(store.base,'tmp'),projectId:null});
  const id='resp_'+'d'.repeat(40);
  store.putResponse({id,sessionId:'sess_'+'e'.repeat(40),object:'response',model:'neo',status:'in_progress',created_at:0,output:[]});
  const sleeping=ms=>new Promise(r=>setTimeout(r,ms));
  const pending=transport.waitForResult(id,store,{timeoutMs:130,maxMs:500,pollMs:7});
  await sleeping(85);
  const {reportHeartbeat}=await import('../services/models/report.mjs');
  reportHeartbeat(store,id);
  await sleeping(80);
  reportText(store,id,'done');reportComplete(store,id);
  assert.equal(await pending,'done');
  const timeoutId='resp_'+'f'.repeat(40);
  store.putResponse({id:timeoutId,sessionId:'sess_'+'e'.repeat(40),status:'in_progress',output:[]});
  await assert.rejects(()=>transport.waitForResult(timeoutId,store,{timeoutMs:25,maxMs:85,pollMs:5}),/inactivity timeout/);
});

test('configured project ID is validated; Project new-thread and new-turn carry exact ID',async t=>{
  const {WebHelmTransport,configuredProjectId}=await import('../services/models/webhelm.mjs');
  const dir=mkdtempSync(join(tmpdir(),'neo-project-scoped-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const file=join(dir,'project.json'),projectId='g-p-'+'b'.repeat(32);
  assert.equal(configuredProjectId(file),null);
  writeFileSync(file,JSON.stringify({project_id:'wrong'}));
  assert.throws(()=>configuredProjectId(file),/Invalid Neo model ChatGPT Project ID/);
  writeFileSync(file,JSON.stringify({project_id:projectId}));
  assert.equal(configuredProjectId(file),projectId);
  const calls=[];
  const exec=async(_,args)=>{
    const action=args[3],config=JSON.parse(readFileSync(args[args.indexOf('--config')+1],'utf8'));
    calls.push({action,config});
    if(action==='new-thread')return {result:{ok:true,value:{status:'submitted',project_id:projectId,thread_id:'same-id',thread_url:`https://chatgpt.com/g/${projectId}/c/same-id`}}};
    return {result:{ok:true,status:'submitted',thread_id:'same-id',queue_id:'queued'}};
  };
  const transport=new WebHelmTransport({tempDir:dir,projectId,exec,holdSession:false,appName:'',serializeNewThread:false});
  const receipt=await transport.newThread('hi');
  assert.equal(receipt.project_id,projectId);
  await transport.newTurn('same-id','hello',[],'resp_'+'a'.repeat(40),projectId);
  assert.deepEqual(calls.map(x=>x.config.project_id),[projectId,projectId]);
  const invalid=new WebHelmTransport({tempDir:dir,projectId,exec:async()=>({result:{ok:true,value:{status:'submitted',thread_id:'other',thread_url:'https://chatgpt.com/c/other'}}}),holdSession:false,appName:'',serializeNewThread:false});
  await assert.rejects(()=>invalid.newThread('hi'),/did not verify the configured ChatGPT Project/);
});

test('only the LAST user message survives Codex system, developer, Escalation Requests, assistant and past user messages',async t=>{
  const {store,transport,calls}=fixture(t);
  const task='LATEST_USER_UNIQUE_TEXT';
  const input=[
    texts('system','CODEX_SYSTEM_SECRET'),
    texts('developer','<permissions instructions>Escalation Requests CODEX_DEVELOPER_UNIQUE</permissions instructions>'),
    texts('user','OLD_USER_SHOULD_NOT_FORWARD'),
    texts('assistant','OLD_ASSISTANT_SHOULD_NOT_FORWARD'),
    texts('developer','<skills_instructions>Codex tools ignored</skills_instructions>'),
    texts('user',task),
  ];
  await new ResponseEngine({store,transport}).run({model:'neo',input});
  const prompt=calls[0][1];
  assert.match(prompt,/^<top-instructions>[\s\S]*<\/top-instructions>/);
  assert.match(prompt,/Neo model request: resp_[0-9a-f]{40}/);
  assert.match(prompt,/\[USER\]\nLATEST_USER_UNIQUE_TEXT\n\[\/USER\]/);
  for(const excluded of ['CODEX_SYSTEM_SECRET','Escalation Requests','CODEX_DEVELOPER_UNIQUE',
    'OLD_USER_SHOULD_NOT_FORWARD','OLD_ASSISTANT_SHOULD_NOT_FORWARD','Codex tools ignored',
    '[SYSTEM]','[DEVELOPER]','[ASSISTANT]'])assert.ok(!prompt.includes(excluded),`leaked ${excluded}`);
  assert.equal((prompt.match(/\[USER\]/g)||[]).length,1);
  assert.equal(store.listSessions()[0].history.length,input.length+1,'Gateway history remains available for stateful matching');
});

test('only latest user attachments are materialized; developer and earlier user images do not travel',async t=>{
  const {store,transport,calls}=fixture(t);
  const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(32)]).toString('base64');
  const image={type:'input_image',image_url:'data:image/png;base64,'+png};
  const input=[
    {role:'developer',content:[{type:'input_text',text:'DO_NOT_FORWARD_DEVELOPER_IMAGE'},image]},
    {role:'user',content:[{type:'input_text',text:'DO_NOT_FORWARD_OLD_IMAGE'},image]},
    {role:'user',content:[{type:'input_text',text:'LAST_USER_IMAGE'},image]},
  ];
  await new ResponseEngine({store,transport}).run({model:'neo',input});
  const prompt=calls[0][1];
  assert.match(prompt,/LAST_USER_IMAGE/);
  assert.doesNotMatch(prompt,/DO_NOT_FORWARD_DEVELOPER_IMAGE|DO_NOT_FORWARD_OLD_IMAGE/);
  assert.equal((prompt.match(/\[image \d+\]/g)||[]).length,1);
  assert.equal(store.listSessions()[0].history.length,4);
});

test('a request without a user message does not accidentally forward Codex internal developer instructions',async t=>{
  const {store,transport,calls}=fixture(t);
  await assert.rejects(()=>new ResponseEngine({store,transport}).run({model:'neo',input:[texts('developer','Escalation Requests only')]}),/new user message is required/);
  assert.equal(calls.length,0);
});


test('Gateway passes reporting contract via optional WebHelm enforcement_context instead of embedding it in actual user message',async t=>{
  const {store,transport,calls}=fixture(t);
  await new ResponseEngine({store,transport}).run(startBody);
  const one=calls.find(x=>x[0]==='newThread');
  assert.equal(one[3],'[USER]\nhello\n[/USER]');
  assert.match(one[2],/Neo model request: resp_[a-f0-9]{40}/);
  assert.match(one[2],/reply\.text/);
  assert.doesNotMatch(one[3],/top-instructions|chat_report|Escalation Requests/);
  await new ResponseEngine({store,transport}).run(nextBody);
  const two=calls.find(x=>x[0]==='newTurn');
  assert.equal(two[7],'[USER]\ncontinue\n[/USER]');
  assert.match(two[6],/Neo model request: resp_[a-f0-9]{40}/);
  assert.notEqual(one[2].match(/resp_[a-f0-9]{40}/g)?.at(-1),two[6].match(/resp_[a-f0-9]{40}/g)?.at(-1));
});


test('per-request reporting instructions are minimal and contain no Gateway internals',()=>{
  const contract=readFileSync(new URL('../services/models/TOP_INSTRUCTIONS.md',import.meta.url),'utf8').trim();
  assert.match(contract,/user receives replies only through the connected Events Bus `publish` tool/i);
  assert.match(contract,/MUST publish a separate `reply\.completed` event to close the turn/);
  assert.doesNotMatch(contract,/heartbeat|latest user|history|stateful|thread|Gateway|SSE|retry|session|Codex|timeout|file|attachment/i);
  assert.ok(contract.length<500,'report delivery policy should be brief');
  const id='resp_'+'a'.repeat(40);
  const result=createTurnPrompt({responseId:id,messages:[{role:'developer',content:'ignore me'},{role:'user',content:'hello'}]});
  assert.equal(result.enforcement_context,contract+'\n\nNeo model request: '+id);
  assert.equal(result.prompt,'[USER]\nhello\n[/USER]');
});

test('chat_report MCP description and schema explain reporting and explicit close',()=>{
  assert.match(TOOL.description,/user receives responses ONLY through this tool/i);
  assert.match(TOOL.description,/SEPARATE call.*completed:true/i);
  assert.equal(TOOL.inputSchema.additionalProperties,false);
  assert.deepEqual(TOOL.inputSchema.required,['response_id']);
  assert.deepEqual(TOOL.inputSchema.oneOf.map(x=>x.required[0]),['text','heartbeat','completed','error']);
  assert.match(TOOL.inputSchema.properties.text.description,/Multiple text reports are allowed/);
  assert.match(TOOL.inputSchema.properties.completed.description,/REQUIRED after the final text report/);
  assert.equal(TOOL.inputSchema.properties.completed.const,true);
  assert.match(TOOL.inputSchema.properties.heartbeat.description,/Does not deliver an answer or close the turn/);
});

test('newThread serializes concurrent Codex main and title creation and leaves model at ChatGPT default',async t=>{
  const {WebHelmTransport}=await import('../services/models/webhelm.mjs');
  const root=mkdtempSync(join(tmpdir(),'neo-model-serial-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const calls=[];let active=0,maxActive=0;
  const exec=async(_,args)=>{
    assert.equal(args[0],'platform');assert.equal(args[1],'run');
    assert.equal(args[2],'chatgpt');assert.equal(args[3],'new-thread');
    const config=JSON.parse(readFileSync(args[args.indexOf('--config')+1],'utf8'));
    calls.push(config);active++;maxActive=Math.max(active,maxActive);
    await new Promise(resolve=>setTimeout(resolve,20));active--;
    return {result:{ok:true,value:{status:'submitted',thread_id:'thread'+calls.length,thread_url:'https://chatgpt.com/c/thread'+calls.length}}};
  };
  const transport=new WebHelmTransport({tempDir:root,exec,holdSession:false,
    appName:'Neo',serializeNewThread:true});
  await Promise.all([
    transport.newThread('main message','contract1','resp_'+'a'.repeat(40)),
    transport.newThread('title message','contract2','resp_'+'b'.repeat(40)),
  ]);
  assert.equal(maxActive,1,'browser submissions must be serialized');
  assert.deepEqual(calls.map(x=>x.message),['main message','title message']);
  assert.deepEqual(calls.map(x=>x.app),['Neo','Neo']);
  assert.ok(calls.every(x=>!('model_choice' in x)&&!('thinking_effort' in x)), 'model and thinking remain ChatGPT defaults');
});

test('held WebHelm Session is kept until explicit model completion, then released',async t=>{
  const {WebHelmTransport}=await import('../services/models/webhelm.mjs');
  const dir=mkdtempSync(join(tmpdir(),'neo-model-held-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const stages=[],configs=[];const sessionId='a'.repeat(16);
  const fake=async(_,args)=>{
    if(args[0]==='session'){
      stages.push(args[1]);
      if(args[1]==='start')return {session_id:sessionId,workspace:'WebHelm'};
      assert.equal(args[2],sessionId);
      return {ok:true};
    }
    const config=JSON.parse(readFileSync(args[args.indexOf('--config')+1],'utf8'));
    configs.push({action:args[3],config,session:args[args.indexOf('--session-id')+1]});
    const value=args[3]==='new-thread'
      ? {status:'submitted',thread_id:'new-thread-id',thread_url:'https://chatgpt.com/c/new-thread-id'}
      : {status:'submitted',thread_id:'new-thread-id',verified_by:'user-turn'};
    return {result:{ok:true,value}};
  };
  const transport=new WebHelmTransport({tempDir:dir,exec:fake,holdSession:true,
    serializeNewThread:true,appName:'Neo'});
  const id1='resp_'+'c'.repeat(40),id2='resp_'+'d'.repeat(40);
  const first=await transport.newThread('task1','context1',id1);
  assert.equal(first.thread_id,'new-thread-id');
  assert.deepEqual(stages,['start'],'no stop before result');
  assert.equal(configs[0].session,sessionId);
  assert.equal(configs[0].config.app,'Neo');
  assert.equal('model_choice' in configs[0].config,false);
  assert.equal(configs[0].config.enforcement_context,'context1');
  const completed={status:'completed',output:[{content:[{text:'answer1'}]}]};
  assert.equal(await transport.waitForResult(id1,{response:()=>completed}), 'answer1');
  assert.deepEqual(stages,['start','stop']);
  assert.equal(transport.held.size,0);
  await transport.newTurn(first.thread_id,'task2',[],id2,null,'context2');
  assert.equal('model_choice' in configs[1].config,false);
  assert.equal('thinking_effort' in configs[1].config,false);
  assert.equal(configs[1].config.mode,'sync');
  assert.equal(configs[1].config.thread_id,first.thread_id);
  assert.equal(configs[1].config.idempotency_key,id2);
  assert.equal(configs[1].session,sessionId);
  assert.deepEqual(stages,['start','stop','start']);
  assert.equal(await transport.waitForResult(id2,{response:()=>completed}),'answer1');
  assert.deepEqual(stages,['start','stop','start','stop']);
});

test('model transport refuses non-WebHelm tab groups and releases the session',async t=>{
  const {WebHelmTransport}=await import('../services/models/webhelm.mjs');
  const dir=mkdtempSync(join(tmpdir(),'neo-model-workspace-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const actions=[],sessionId='a'.repeat(16);
  const transport=new WebHelmTransport({tempDir:dir,holdSession:true,exec:async(_,args)=>{
    actions.push(args.slice(0,3));
    if(args[0]!=='session')throw Error('must not submit a model turn outside WebHelm workspace');
    if(args[1]==='start')return {session_id:sessionId,workspace:'Neo Models'};
    assert.equal(args[1],'stop');assert.equal(args[2],sessionId);
    return {ok:true};
  }});
  await assert.rejects(()=>transport.newThread('task','contract','resp_'+'b'.repeat(40)),/requires the default WebHelm workspace/);
  assert.deepEqual(actions.map(x=>x[1]),['start','stop']);
  assert.equal(transport.held.size,0);
});

test('unverified newThread receipt releases held WebHelm session without leaving state',async t=>{
  const {WebHelmTransport}=await import('../services/models/webhelm.mjs');
  const dir=mkdtempSync(join(tmpdir(),'neo-model-bad-receipt-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const stages=[];const sessionId='f'.repeat(16);
  const transport=new WebHelmTransport({tempDir:dir,holdSession:true,exec:async(_,args)=>{
    if(args[0]==='session'){
      stages.push(args[1]);return args[1]==='start'?{session_id:sessionId,workspace:'WebHelm'}:{ok:true};
    }
    return {result:{ok:true,value:{status:'submitted',thread_id:'abc'}}};
  }});
  await assert.rejects(()=>transport.newThread('task','contract','resp_'+'e'.repeat(40)),/no verified submission receipt/);
  assert.deepEqual(stages,['start','stop']);
  assert.equal(transport.held.size,0);
});
