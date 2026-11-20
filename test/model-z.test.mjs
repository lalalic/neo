import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ModelStore} from '../services/models/store.mjs';
import {createModelServer} from '../services/models/server.mjs';
import {ZWebHelmTransport,Z_BOOTSTRAP_URL} from '../services/models/z-webhelm.mjs';
import {ResponseEngine} from '../services/models/responses.mjs';

const token='test-only-neo-model-token-long-enough';
const owner='12345678-1234-4234-8234-123456789123';
const message=(text,id)=>({role:'user',...(id?{id}:{}),content:[{type:'input_text',text}]});
function fixture(t){
  const dir=mkdtempSync(join(tmpdir(),'neo-z-model-test-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const calls=[];let starts=0,submissions=0;
  const exec=async (_,args)=>{
    if(args[0]==='session'){
      if(args[1]==='start'){assert.deepEqual(args.slice(0,4),['session','start','--url','about:blank']);return {session_id:'abcdef0123456789',workspace:'WebHelm'};}
      assert.equal(args[1],'stop');return {ok:true};
    }
    assert.deepEqual(args.slice(0,3),['platform','run','z']);
    const action=args[3];
    assert.ok(args.includes('--session-id'));
    const config=JSON.parse(readFileSync(args[args.indexOf('--config')+1],'utf8'));
    calls.push({action,config});
    const thread_id=action==='new-thread'?'12345678-1234-4234-8234-abcdefffffff':config.thread_id;
    if(!config.resume){submissions++;if(action==='new-thread')starts++;}
    return {result:{ok:true,value:{status:config.resume?'completed':'submitted',
      ...(config.resume?{answer:action==='new-thread'?'NEO_BOOTSTRAP_PASS':'Z answer '+submissions}:{}),
      verified_by:config.resume?'Z.ai webpage SSE chat:completion done=true':'matching user message + cleared composer + durable thread URL',
      thread_id,thread_url:'https://chat.z.ai/c/'+thread_id}}};
  };
  const z=new ZWebHelmTransport({exec,tempDir:dir,issueToken:async path=>writeFileSync(path,'test-only-short-lived-neo-token-abcdefgh',{mode:0o600,flag:'wx'}),revokeToken:async()=>{}});
  const store=new ModelStore(dir);
  return {z,store,calls,get starts(){return starts}};
}

test('Z transport uses only native webpage lifecycle with verified SSE completion',async t=>{
  const {z,store,calls}=fixture(t);
  const first='resp_'+'a'.repeat(40);
  store.putResponse({id:first,status:'in_progress',sessionId:'sess_'+'a'.repeat(40),model:'z',output:[]});
  store.putSession({id:'sess_'+'a'.repeat(40),lastResponseId:first,lastInput:[{role:'user',text:'hi',images:[]}],history:[],status:'submitting'});
  const receipt=await z.bootstrapThread(first);
  assert.equal(receipt.status,'completed');
  assert.equal(receipt.bootstrap_verified,true);
  assert.equal(receipt.thread_url,'https://chat.z.ai/c/'+receipt.thread_id);
  assert.equal(calls[0].action,'new-thread');
  assert.equal(calls[0].config.message,`bootstrap the chat with ${Z_BOOTSTRAP_URL} with token test-only-short-lived-neo-token-abcdefgh.`);
  assert.deepEqual(Object.keys(calls[0].config).sort(),['message','mode','timeout_seconds','wait']);
  assert.equal('answer' in receipt,false);
  assert.equal((await import('node:fs')).readdirSync(store.base).filter(x=>x.startsWith('z-bootstrap-')).length,0);
  await z.newTurn(receipt.thread_id,'hi',[],first);
  assert.equal(calls[1].action,'new-thread');
  assert.equal(calls[1].config.resume,true);
  assert.equal(calls[2].action,'new-turn');
  assert.equal(calls[2].config.message,'hi');
  assert.equal(calls[2].config.wait,false);
  assert.equal(calls[3].config.resume,true);
  assert.equal(await z.waitForResult(first,store),'Z answer 2');
  assert.equal(store.response(first).status,'completed');
  const next='resp_'+'b'.repeat(40);
  const ss=store.session('sess_'+'a'.repeat(40));ss.lastResponseId=next;store.putSession(ss);
  store.putResponse({id:next,status:'in_progress',sessionId:ss.id,model:'z',output:[]});
  await z.newTurn(receipt.thread_id,'follow up',[],next);
  assert.equal(calls[4].action,'new-turn');
  assert.equal(calls[4].config.thread_id,receipt.thread_id);
  assert.equal(await z.waitForResult(next,store),'Z answer 3');
  assert.equal(store.response(next).model,'z');
});

test('Z rejects unverified completion and preserves uncertain session for reconciliation',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'neo-z-fail-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const stages=[];
  const z=new ZWebHelmTransport({tempDir:dir,issueToken:async path=>writeFileSync(path,'mock-token-abcdefghijklmnopqrstu',{mode:0o600,flag:'wx'}),revokeToken:async()=>{},exec:async(_,args)=>{
    stages.push(args[1]||'');
    if(args[0]==='session'&&args[1]==='start')return {session_id:'abcdef0123456789',workspace:'WebHelm'};
    return {result:{ok:true,value:{status:'pending',thread_id:null,next_step:'resume'}}};
  }});
  const id='resp_'+'e'.repeat(40);
  await assert.rejects(()=>z.bootstrapThread(id),/manual reconciliation Session/);
  assert.equal(z.pendingSessions.get(id),'abcdef0123456789');
  assert.deepEqual(stages,['start','run']); // Pending browser tab is deliberately NOT closed.
});

test('chatgpt and z have independent durable Codex Thread maps across model switches',async t=>{
  const {store,z,calls}=fixture(t);
  const chatCalls=[];
  const chat={
    async newThread(){chatCalls.push('new-thread');return {status:'submitted',thread_id:'chat-thread',thread_url:'https://chatgpt.com/c/chat-thread'};},
    async newTurn(threadId){chatCalls.push('new-turn:'+threadId);return {status:'submitted',thread_id:threadId,queue_id:'q'};},
    async waitForResult(id,s){const {reportText,reportComplete}=await import('../services/models/report.mjs');reportText(s,id,'Chat answer');return reportComplete(s,id).output[0].content[0].text;}
  };
  const engine=new ResponseEngine({store,transport:chat,transports:{chatgpt:chat,z}});
  const first=await engine.run({model:'chatgpt',input:[message('hello')]},{codexThreadId:owner});
  const second=await engine.run({model:'z',previous_response_id:first.id,input:[message('hello')]},{codexThreadId:owner});
  assert.equal(second.status,'completed');assert.equal(second.output[0].content[0].text,'Z answer 2');
  assert.equal(second.model,'z');
  const third=await engine.run({model:'chatgpt',previous_response_id:second.id,input:[message('back')]},{codexThreadId:owner});
  assert.equal(third.status,'completed');
  assert.deepEqual(chatCalls,['new-thread','new-turn:chat-thread']);
  assert.equal(calls.length,4);
  const before=new ModelStore(store.base).listSessions().filter(s=>s.codexThreadId===owner);
  assert.equal(before.length,2);
  assert.deepEqual(before.map(s=>s.model).sort(),['chatgpt','z']);
  assert.equal(before.find(s=>s.model==='z').threadUrl.startsWith('https://chat.z.ai/c/'),true);
  const after=new ResponseEngine({store:new ModelStore(store.base),transport:chat,transports:{chatgpt:chat,z}});
  await after.run({model:'z',input:[message('resumed with z')]},{codexThreadId:owner});
  assert.equal(calls[4].action,'new-turn');
  assert.equal(calls.filter(x=>x.action==='new-thread'&&!x.config.resume).length,1,'resume never bootstraps again');
  assert.equal(new ModelStore(store.base).listSessions().length,2);
});

test('Model API selects chatgpt and z; keeps neo as hidden legacy alias',async t=>{
  const {store,z}=fixture(t);
  const fake={
    async newThread(){return {status:'submitted',thread_id:'chat-thread',thread_url:'https://chatgpt.com/c/chat-thread'};},
    async waitForResult(id,s){const {reportText,reportComplete}=await import('../services/models/report.mjs');reportText(s,id,'Chat ok');return reportComplete(s,id).output[0].content[0].text;}
  };
  const {server}=createModelServer({token,store,transport:fake,zTransport:z});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const headers={'Content-Type':'application/json',Authorization:'Bearer '+token};
  const catalog=await(await fetch(base+'/v1/models',{headers})).json();
  assert.deepEqual(catalog.data.map(x=>x.id),['chatgpt','z']);
  const catalogCodex=await(await fetch(base+'/v1/models?client_version=0.165.0',{headers})).json();
  assert.deepEqual(catalogCodex.models.map(x=>x.slug),['chatgpt','z']);
  const ask=async model=>{
    const r=await fetch(base+'/v1/responses',{method:'POST',headers,body:JSON.stringify({model,input:[message('hello')],stream:true})});
    assert.equal(r.status,200);return r.text();
  };
  assert.match(await ask('chatgpt'),/Chat ok/);
  assert.match(await ask('z'),/Z answer 2/);
  assert.match(await ask('neo'),/Chat ok/);
  assert.deepEqual(store.listSessions().map(x=>x.model).sort(),['chatgpt','chatgpt','z']);
  const unknown=await fetch(base+'/v1/responses',{method:'POST',headers,body:JSON.stringify({model:'unknown',input:'hi'})});
  assert.equal(unknown.status,400);
});

test('Z rejects image inputs without creating an uncertain model session',async t=>{
  const {store,z}=fixture(t);
  const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(100)]).toString('base64');
  const engine=new ResponseEngine({store,transports:{z},transport:z});
  await assert.rejects(()=>engine.run({model:'z',input:[{role:'user',content:[
    {type:'input_text',text:'look'},{type:'input_image',image_url:'data:image/png;base64,'+png}
  ]}]}),/text only/);
  assert.equal(store.listSessions().length,0);
});

test('Z fails closed on a non-WebHelm tab group and releases that session',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'neo-z-wrong-group-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const stages=[];
  const z=new ZWebHelmTransport({tempDir:dir,issueToken:async path=>writeFileSync(path,'mock-token-abcdefghijklmnopqrstu',{mode:0o600,flag:'wx'}),revokeToken:async()=>{},exec:async(_,args)=>{
    stages.push(args[1]);
    if(args[1]==='start')return {session_id:'abcdeffedcba0123',workspace:'Neo Models'};
    if(args[1]==='stop')return {ok:true};
    throw Error('should not submit outside default WebHelm workspace');
  }});
  await assert.rejects(()=>z.bootstrapThread('resp_'+'1'.repeat(40)),/requires the default WebHelm workspace/);
  assert.deepEqual(stages,['start','stop']);
});


test('Z bootstrap must verify NEO_BOOTSTRAP_PASS before forwarding any user task',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'neo-z-bootstrap-blocked-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const calls=[];
  const z=new ZWebHelmTransport({tempDir:dir,
    issueToken:async path=>writeFileSync(path,'short-lived-token-for-bootstrapping-only',{flag:'wx',mode:0o600}),revokeToken:async()=>{},
    exec:async(_,args)=>{
      if(args[0]==='session')return args[1]==='start'?{session_id:'abcdef0123456789',workspace:'WebHelm'}:{ok:true};
      const data=JSON.parse(readFileSync(args[args.indexOf('--config')+1]));
      calls.push({action:args[3],message:data.message});
      return {result:{ok:true,value:{status:data.resume?'completed':'submitted',...(data.resume?{answer:'NEO_TOOL_UNAVAILABLE'}:{}),
        verified_by:data.resume?'Z.ai webpage SSE chat:completion done=true':'matching user message + cleared composer + durable thread URL',
        thread_id:'12345678-1234-4234-8234-abcdefffffff',
        thread_url:'https://chat.z.ai/c/12345678-1234-4234-8234-abcdefffffff'}}};
    }
  });
  const store=new ModelStore(dir);
  const engine=new ResponseEngine({store,transport:z,transports:{z}});
  await assert.rejects(()=>engine.run({model:'z',input:[message('secret user task must not be delivered')]},{codexThreadId:owner}),/did not verify Neo MCP bootstrap/);
  assert.equal(calls.length,2);
  assert.equal(calls[0].action,'new-thread');
  assert.equal(calls[1].message,undefined,'no prompt is resent on resume');
  assert.equal(calls[0].message.includes(Z_BOOTSTRAP_URL),true);
  assert.equal(calls[0].message.includes('secret user task'),false);
  assert.equal(store.listSessions()[0].status,'uncertain');
  assert.equal((await import('node:fs')).readdirSync(dir).filter(x=>x.startsWith('z-bootstrap-')).length,0);
});

test('Z never sends task or creates a WebHelm tab when temporary token issuance fails',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'neo-z-token-fail-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  let calls=0;
  const z=new ZWebHelmTransport({tempDir:dir,
    issueToken:async()=>{throw Error('Sensitive operator token detail must not leak');},revokeToken:async()=>{},
    exec:async()=>{calls++;throw Error('browser must not launch before token issuance')}
  });
  await assert.rejects(()=>z.bootstrapThread('resp_'+'b'.repeat(40)),/Unable to issue a short-lived Neo MCP token/);
  assert.equal(calls,0);
  assert.equal((await import('node:fs')).readdirSync(dir).filter(x=>x.startsWith('z-bootstrap-')).length,0);
});


test('Z bootstrap rejects a denial mentioning PASS, and never sends the user task',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'neo-z-false-pass-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const actions=[];
  const z=new ZWebHelmTransport({tempDir:dir,
    issueToken:async path=>writeFileSync(path,'short-lived-token-abcdefghijklmnopqrst',{flag:'wx',mode:0o600}),revokeToken:async()=>{},
    exec:async(_,args)=>{
      if(args[0]==='session')return args[1]==='start'?{session_id:'abcdef0123456789',workspace:'WebHelm'}:{ok:true};
      const cfg=JSON.parse(readFileSync(args[args.indexOf('--config')+1]));
      actions.push(args[3]);
      return {result:{ok:true,value:{status:cfg.resume?'completed':'submitted',...(cfg.resume?{answer:'NEO_BOOTSTRAP_BLOCKED: cannot report NEO_BOOTSTRAP_PASS'}:{}),
        verified_by:cfg.resume?'Z.ai webpage SSE chat:completion done=true':'matching user message + cleared composer + durable thread URL',thread_id:'12345678-1234-4234-8234-abcdefffffff',
        thread_url:'https://chat.z.ai/c/12345678-1234-4234-8234-abcdefffffff'}}};
    }
  });
  await assert.rejects(()=>new ResponseEngine({store:new ModelStore(dir),transport:z,transports:{z}})
    .run({model:'z',input:[message('never deliver this task')]},{codexThreadId:owner}),/did not verify Neo MCP bootstrap/);
  assert.deepEqual(actions,['new-thread','new-thread']);
});

test('Z bootstrap redacts its injected token if the WebHelm action unexpectedly echoes it in an error',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'neo-z-redact-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const secret='short-lived-token-secret-abcdefghijklmnop';
  const z=new ZWebHelmTransport({tempDir:dir,
    issueToken:async path=>writeFileSync(path,secret,{flag:'wx',mode:0o600}),revokeToken:async()=>{},
    exec:async(_,args)=>{
      if(args[0]==='session')return args[1]==='start'?{session_id:'abcdef0123456789',workspace:'WebHelm'}:{ok:true};
      throw Error('action failed: '+secret);
    }
  });
  await assert.rejects(()=>z.bootstrapThread('resp_'+'f'.repeat(40)),error=>{
    assert.equal(error.message.includes(secret),false);
    assert.match(error.message,/\[REDACTED\]/);
    return true;
  });
  assert.equal((await import('node:fs')).readdirSync(dir).some(x=>x.startsWith('z-bootstrap-')),false);
});


test('Z bootstrap revokes its short-lived token after a verified site-level bootstrap rejection',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'neo-z-revoke-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  let revoked=0;
  const z=new ZWebHelmTransport({tempDir:dir,
    issueToken:async path=>writeFileSync(path,'short-lived-access-token-to-be-revoked',{flag:'wx',mode:0o600}),
    revokeToken:async path=>{assert.equal(existsSync(path),true);revoked++;},
    exec:async(_,args)=>{
      if(args[0]==='session')return args[1]==='start'?{session_id:'abcdef0123456789',workspace:'WebHelm'}:{ok:true};
      const config=JSON.parse(readFileSync(args[args.indexOf('--config')+1]));
      return {result:{ok:true,value:{status:config.resume?'completed':'submitted',...(config.resume?{answer:'NEO_AUTH_REQUIRED'}:{}),
        verified_by:config.resume?'Z.ai webpage SSE chat:completion done=true':'matching user message + cleared composer + durable thread URL',thread_id:'12345678-1234-4234-8234-abcdefffffff',
        thread_url:'https://chat.z.ai/c/12345678-1234-4234-8234-abcdefffffff'}}};
    }
  });
  await assert.rejects(()=>z.bootstrapThread('resp_'+'c'.repeat(40)),/did not verify Neo MCP bootstrap/);
  assert.equal(revoked,1);
  assert.equal((await import('node:fs')).readdirSync(dir).some(x=>x.startsWith('z-bootstrap-')),false);
});


test('Z pending site SSE is polled using resume only; original message submitted exactly once',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'neo-z-resume-only-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const calls=[];let resumptions=0;
  const id='resp_'+'d'.repeat(40),thread='12345678-1234-4234-8234-abcdefffffff';
  const z=new ZWebHelmTransport({tempDir:dir,timeoutSeconds:4,overallTimeoutSeconds:30,
    issueToken:async path=>writeFileSync(path,'short-lived-z-mcp-test-token-abcdef',{mode:0o600,flag:'wx'}),
    revokeToken:async()=>{},exec:async(_,args)=>{
      if(args[0]==='session')return args[1]==='start'?{session_id:'abcdef0123456789',workspace:'WebHelm'}:{ok:true};
      const cfg=JSON.parse(readFileSync(args[args.indexOf('--config')+1]));
      calls.push(cfg);
      if(!cfg.resume)return {result:{ok:true,value:{status:'submitted',thread_id:thread,thread_url:'https://chat.z.ai/c/'+thread,
        verified_by:'matching user message + cleared composer + durable thread URL'}}};
      resumptions++;
      return {result:{ok:true,value:resumptions===1?{status:'pending',thread_id:thread}:
        {status:'completed',answer:'NEO_BOOTSTRAP_PASS',thread_id:thread,
          verified_by:'Z.ai webpage SSE chat:completion done=true',thread_url:'https://chat.z.ai/c/'+thread}}};
    }
  });
  const out=await z.bootstrapThread(id);
  assert.equal(out.bootstrap_verified,true);
  assert.equal(calls.length,3);
  assert.equal(calls[0].wait,false);
  assert.equal(calls[0].message.startsWith('bootstrap the chat with '+Z_BOOTSTRAP_URL),true);
  assert.equal(calls.slice(1).every(c=>c.resume===true&&c.thread_id===thread&&!c.message),true,
    'no follow-up may resubmit the token-bearing prompt');
  assert.equal(z.pendingSessions.size,0);
});

test('Z pending delivery preserves active one-hour token for in-progress site bootstrap',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'neo-z-pending-token-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  let revoked=0;
  const id='resp_'+'9'.repeat(40);
  const z=new ZWebHelmTransport({tempDir:dir,timeoutSeconds:1,overallTimeoutSeconds:1,
    issueToken:async path=>writeFileSync(path,'temporary-access-token-for-z-model',{mode:0o600,flag:'wx'}),
    revokeToken:async()=>{revoked++},exec:async(_,args)=>{
      if(args[0]==='session')return args[1]==='start'?{session_id:'abcdef0123456789',workspace:'WebHelm'}:{ok:true};
      const cfg=JSON.parse(readFileSync(args[args.indexOf('--config')+1]));
      return {result:{ok:true,value:cfg.resume?{status:'pending',thread_id:'12345678-1234-4234-8234-abcdefffffff'}:
        {status:'submitted',verified_by:'matching user message + cleared composer + durable thread URL',
          thread_id:'12345678-1234-4234-8234-abcdefffffff',
          thread_url:'https://chat.z.ai/c/12345678-1234-4234-8234-abcdefffffff'}}};
    }
  });
  await assert.rejects(()=>z.bootstrapThread(id),/manual reconciliation Session/);
  assert.equal(revoked,0,'uncertain in-flight bootstrap must not lose its temporary token');
  assert.equal(z.pendingSessions.get(id),'abcdef0123456789');
});
