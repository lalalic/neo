import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createOrchestratorV1Client} from '../services/models/orchestrator-v1-client.mjs';
import {createModelServer} from '../services/models/server.mjs';
import {ModelStore} from '../services/models/store.mjs';

const uuid='66666666-6666-4666-8666-666666666666';
const rid='resp_'+'a'.repeat(40);
const token='internal-model-test-token-1234567890';
const event=(type,response)=>'event: '+type+'\ndata: '+JSON.stringify({type,response})+'\n\n';

test('private Orchestrator uses authenticated /v1 HTTP SSE, fixed thread-id and one-use local file grant',async()=>{
  const grants=new Map();
  const observed=[];
  const complete={id:rid,status:'completed',output:[{content:[{text:'complete reply'}]}]};
  const fetchImpl=async (url,opts)=>{
    observed.push({url,opts});
    assert.equal(url,'http://127.0.0.1:8769/v1/responses');
    assert.equal(opts.headers.Authorization,'Bearer '+token);
    assert.equal(opts.headers['thread-id'],uuid);
    assert.deepEqual(grants.get(opts.headers['x-neo-orchestrator-grant']),
      {codexThreadId:uuid,attachmentFiles:['/private/verified-file']});
    const body=JSON.parse(opts.body);
    assert.equal(body.model,'neo');
    assert.equal(body.stream,true);
    assert.equal(body.enforcement_context,'caller context');
    assert.ok(!opts.body.includes('/private/verified-file'),
      'Verified file path must never enter the HTTP JSON body');
    return new Response(event('response.created',{id:rid,status:'in_progress'})+
      event('response.completed',complete),{status:200,
      headers:{'content-type':'text/event-stream; charset=utf-8'}});
  };
  const client=createOrchestratorV1Client({getOrigin:()=> 'http://127.0.0.1:8769',
    token,grants,fetchImpl});
  const started=[];
  const response=await client.run({input:'hello',enforcement_context:'caller context'},
    {codexThreadId:uuid,attachmentFiles:['/private/verified-file'],onResponseStarted:id=>started.push(id)});
  assert.equal(response.output[0].content[0].text,'complete reply');
  assert.deepEqual(started,[rid]);
  assert.equal(observed.length,1);
  assert.equal(grants.size,0,'Private grant must be revoked even when SSE finishes successfully');
});

test('internal /v1 stream rejects incorrect terminal identity and missing explicit completion',async()=>{
  const response=(sse)=>new Response(sse,{status:200,headers:{'content-type':'text/event-stream'}});
  const grants=new Map();
  const client=createOrchestratorV1Client({getOrigin:()=> 'http://127.0.0.1:8769',
    token,grants,fetchImpl:async()=>response(
      event('response.created',{id:rid,status:'in_progress'})+
      event('response.completed',{id:'resp_'+'b'.repeat(40),status:'completed',output:[]}),
    )});
  await assert.rejects(()=>client.run({input:'hello'},{codexThreadId:uuid}),/does not match/);
  assert.equal(grants.size,0);
  const incomplete=createOrchestratorV1Client({getOrigin:()=> 'http://127.0.0.1:8769',
    token,grants,fetchImpl:async()=>response(event('response.created',{id:rid,status:'in_progress'}))});
  await assert.rejects(()=>incomplete.run({input:'hello'},{codexThreadId:uuid}),/without explicit completion/);
  assert.equal(grants.size,0);
});

test('generic /v1 must reject a forged internal attachment grant before model transport',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'neo-private-v1-grant-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const store=new ModelStore(dir);
  const transport={async newThread(){throw Error('No model transport must be invoked')}};
  const {server}=createModelServer({token,store,transport});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const response=await fetch('http://127.0.0.1:'+server.address().port+'/v1/responses',{
    method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json',
      'thread-id':uuid,'x-neo-orchestrator-grant':'forged-grant-123'},
    body:JSON.stringify({model:'neo',stream:true,input:'malicious'}),
  });
  assert.equal(response.status,403);
  assert.equal(store.listSessions().length,0);
  const forbidden=await fetch('http://127.0.0.1:'+server.address().port+'/v1/orchestrator/mapping',{
    method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},
    body:'{}'});
  assert.equal(forbidden.status,404,'No public mapping editor may exist');
});
