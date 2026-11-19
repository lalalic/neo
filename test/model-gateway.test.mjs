import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ModelStore} from '../services/models/store.mjs';
import {ResponseEngine,streamResponse} from '../services/models/responses.mjs';
import {createModelServer} from '../services/models/server.mjs';
import {reportCompleted,reportText,reportLargeFile} from '../services/models/report.mjs';
import {handleMcp,invokeReport,TOOL} from '../services/models/mcp.mjs';
import {createTurnPrompt} from '../services/models/prompt.mjs';

const token='development-model-test-token-0123456789abcdef';
function fixture(t){
  const dir=mkdtempSync(join(tmpdir(),'neo-generic-models-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const calls=[];
  let n=0;
  const store=new ModelStore(dir);
  const transport={
    async newThread(prompt){calls.push(['newThread',prompt]);return {thread_id:'thread-'+calls.filter(x=>x[0]==='newThread').length,thread_url:'https://chatgpt.com/c/thread-'+calls.filter(x=>x[0]==='newThread').length,status:'submitted'};},
    async newTurn(threadId,prompt,files,responseId){calls.push(['newTurn',threadId,prompt,files,responseId]);return {status:'submitted',thread_id:threadId,queue_id:'queued_'+responseId};},
    async waitForResult(id,writeStore){
      calls.push(['waitForResult',id]);
      const output=n++===0?'First reply':'Second reply';
      const completed=reportText(writeStore,id,output);
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
  assert.match(firstPrompt,/mcp\.models chat_report/);
  assert.match(firstPrompt,/agent-specific instructions come from client/);
  assert.match(firstPrompt,/\[SYSTEM\]/);
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
  const transport=new WebHelmTransport({tempDir:dir,binary:'/example/webhelm',exec:fake});
  const start=await transport.newThread('generic prompt');
  assert.equal(start.thread_id,'thread-xyz');
  await transport.newTurn(start.thread_id,'follow up',[],'resp_'+'f'.repeat(40));
  assert.deepEqual(calls.map(x=>x.action),['new-thread','new-turn']);
  assert.equal(calls[0].auto,true);
  assert.equal(calls[1].auto,false,'durable new-turn queue has no browser Session');
  assert.equal(calls[1].config.thread_id,'thread-xyz');
  assert.equal(calls[1].config.idempotency_key,'resp_'+'f'.repeat(40));
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
  assert.match(first,/\[SYSTEM\][\s\S]*\[USER\]/);
  assert.match(first,/mcp\.models chat_report/);
  const id=first.match(/Neo model request: (resp_[0-9a-f]{40})/)[1];
  assert.match(first,new RegExp(id));
  assert.equal(readFileSync(store.base+'/sessions/'+store.listSessions()[0].id+'.json','utf8').includes('First reply'),true);
  const {existsSync}=await import('node:fs');
  assert.equal(existsSync(store.base+'/requests/'+id+'.request.json'),false);
  assert.equal(existsSync(store.base+'/requests/'+id+'.output.txt'),false);
  await new ResponseEngine({store,transport}).run(nextBody);
  assert.match(calls[2][2],/mcp\.models chat_report/);
  assert.match(calls[2][2],/\[USER\]\ncontinue/);
  assert.doesNotMatch(calls[2][2],/agent-specific instructions come from client|\[SYSTEM\]/);
});

test('long user inputs stay fully inline and WebHelm transports unchanged',async t=>{
  const {store,transport,calls}=fixture(t);
  const payload='Long conversation: '+('中文内容 and code const x = 1; '.repeat(4000));
  await new ResponseEngine({store,transport}).run({model:'neo',input:[texts('user',payload)]});
  const prompt=calls[0][1];
  assert.ok(prompt.includes(payload));
  assert.match(prompt,/mcp\.models chat_report/);
  assert.doesNotMatch(prompt,/\.request\.json|\.output\.txt|READ |Read /);
  assert.equal(prompt.match(/Long conversation:/g)?.length,1);
  const {existsSync}=await import('node:fs');
  assert.equal(existsSync(join(store.base,'requests')),false);
});

test('mcp.models chat_report delivers arbitrary-size text directly; retries and errors are safe',async t=>{
  const {store}=fixture(t);
  const make=id=>store.putResponse({id,sessionId:'sess_'+('a'.repeat(40)),object:'response',model:'neo',status:'in_progress',created_at:0,output:[]});
  const id='resp_'+'a'.repeat(40);make(id);
  const report=handleMcp({id:1,method:'tools/call',params:{name:'chat_report',arguments:{response_id:id,text:'HELLO'}}},store);
  assert.equal(report.result.isError,false);
  assert.equal(store.response(id).output[0].content[0].text,'HELLO');
  assert.equal(handleMcp({id:2,method:'tools/call',params:{name:'chat_report',arguments:{response_id:id,text:'HELLO'}}},store).result.isError,false);
  assert.equal(handleMcp({id:3,method:'tools/call',params:{name:'chat_report',arguments:{response_id:id,text:'OTHER'}}},store).result.isError,true);
  const hugeId='resp_'+'b'.repeat(40);make(hugeId);
  const largeText='中文'.repeat(35000);
  const large=handleMcp({id:4,method:'tools/call',params:{name:'chat_report',arguments:{response_id:hugeId,text:largeText}}},store);
  assert.equal(large.result.isError,false);
  assert.equal(store.response(hugeId).output[0].content[0].text,largeText);
  assert.equal(TOOL.inputSchema.properties.text.maxLength,undefined);
  assert.equal(TOOL.inputSchema.properties.file,undefined);
  const unexpectedFile=handleMcp({id:5,method:'tools/call',params:{name:'chat_report',arguments:{response_id:hugeId,file:'/tmp/file'}}},store);
  assert.equal(unexpectedFile.result.isError,true);
  const failId='resp_'+'c'.repeat(40);make(failId);
  assert.equal(handleMcp({id:6,method:'tools/call',params:{name:'chat_report',arguments:{response_id:failId,error:'Actual model failure'}}},store).result.isError,false);
  assert.equal(store.response(failId).status,'failed');
  assert.equal(handleMcp({id:7,method:'tools/list'},store).result.tools[0].name,'chat_report');
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
