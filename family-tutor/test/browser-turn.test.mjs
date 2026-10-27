import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BrowserWorkspaceTutorClient } from '../skills/family-tutor/runtime/tutor-orchestrator/src/browser-workspace-tutor.mjs';
import { DiscordDeliveryRegistry } from '../skills/family-tutor/runtime/tutor-orchestrator/src/discord-delivery.mjs';

test('tutor turn enqueues with Webhelm and never reads the assistant DOM',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ft-new-turn-'));
  const state=path.join(dir,'.family-tutor');
  await fs.mkdir(state);
  await fs.writeFile(path.join(state,'browser-workspace-bindings.json'),
    JSON.stringify({version:2,bindings:{kid:{learner:'kid',project_id:'project',thread_id:'thread'}}}));
  const actions=[];
  const run=async(_cmd,args)=>{
    if(args[0]==='status') return {stdout:JSON.stringify({ok:true})};
    if(args[0]==='platform'){
      assert.equal(args[3],'new-turn');
      const config=JSON.parse(await fs.readFile(args[args.indexOf('--config')+1],'utf8'));
      actions.push(config);
      const output={status:'submitted',thread_id:'thread',project_id:'project'};
      return {stdout:JSON.stringify({result:{ok:true,stdout:JSON.stringify(output)}})};
    }
    throw Error('unexpected browser action');
  };
  const client=new BrowserWorkspaceTutorClient({instanceDir:dir,run});
  try{
    await client.startQueue();
    const receipt=await client.enqueue({learner:'kid',prompt:'Help me'});
    assert.equal(receipt.status,'submitted');
    assert.deepEqual(actions,[{project_id:'project',thread_id:'thread',message:'Help me',mode:'async',mergeable:true}]);
  }finally{
    await client.stop();
    await fs.rm(dir,{recursive:true,force:true});
  }
});

test('discord delivery is idempotent and bound to an opaque expiring correlation',async()=>{
  let count=0,clock=1000;
  const registry=new DiscordDeliveryRegistry({ttlMs:200,now:()=>clock});
  const correlationId=registry.register(async text=>{count++;assert.equal(text,'Hello');return {id:'discord-123'};});
  const [first,second]=await Promise.all([
    registry.deliver({correlationId,text:'Hello'}),
    registry.deliver({correlationId,text:'Hello'}),
  ]);
  assert.equal(first.messageId,'discord-123');
  assert.deepEqual(first,second);
  assert.equal(count,1);
  await assert.rejects(registry.deliver({correlationId:'unknown',text:'Hello'}),/Unknown or expired/);
  const stale=registry.register(async()=>({id:'unused'}));
  clock+=201;
  await assert.rejects(registry.deliver({correlationId:stale,text:'Hello'}),/Unknown or expired/);
});
