import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BrowserWorkspaceTutorClient } from '../skills/family-tutor/runtime/tutor-orchestrator/src/browser-workspace-tutor.mjs';

test('tutor turn verifies assistant completion and keeps each learner thread',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ft-thread-turn-'));
  const state=path.join(dir,'.family-tutor');
  await fs.mkdir(state);
  await fs.writeFile(path.join(state,'browser-workspace-bindings.json'),
    JSON.stringify({version:2,bindings:{kid:{learner:'kid',project_id:'project',thread_id:'thread'}}}));
  const actions=[];
  const run=async(_cmd,args)=>{
    if(args[0]==='status') return {stdout:JSON.stringify({admin_helper:'/tmp/admin.mjs'})};
    if(args[0]==='session'&&args[1]==='start') return {stdout:JSON.stringify({session_id:'session',target_id:'tab'})};
    if(args[0]==='session'&&args[1]==='stop') return {stdout:'{}'};
    if(args[0]==='platform'){
      assert.equal(args[3],'thread-turn');
      const config=JSON.parse(await fs.readFile(args[args.indexOf('--config')+1],'utf8'));
      actions.push(config);
      const output={status:'completed',assistant_message_id:'assistant-1',text:'Verified tutor reply'};
      return {stdout:JSON.stringify({result:{ok:true,stdout:JSON.stringify(output)}})};
    }
    throw Error('unexpected command');
  };
  const client=new BrowserWorkspaceTutorClient({instanceDir:dir,run,loadAdmin:async()=>({
    ensureWorkspace:async()=>{},deleteWorkspace:async()=>{}
  })});
  try{
    await client.start();
    const result=await client.turn({learner:'kid',prompt:'Help me'});
    assert.equal(result.text,'Verified tutor reply');
    assert.equal(actions[0].thread_url,'https://chatgpt.com/g/project/c/thread');
    assert.equal(actions[0].target_id,'tab');
    assert.equal('app' in actions[0],false,'ChatGPT turns must not depend on the retired Family Tutor MCP app');
  }finally{
    await client.stop();
    await fs.rm(dir,{recursive:true,force:true});
  }
});
