#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const instance=process.env.FAMILY_TUTOR_INSTANCE||path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../runs/family');
const cli=process.env.BROWSER_WORKSPACE_COMMAND||path.join(os.homedir(),'.agents/skills/browser-workspace/bin/browser-workspace');
const config=JSON.parse(await fs.readFile(path.join(instance,'config/family.config.json'),'utf8'));
const state=JSON.parse(await fs.readFile(path.join(instance,'.family-tutor/browser-workspace-bindings.json'),'utf8'));
const learners=config.children.map(child=>child.id);
const bindings=state.bindings||{};
let failed=false;
for(const learner of learners){
  const binding=bindings[learner];
  if(!binding?.project_id||!binding?.thread_id){
    console.log(JSON.stringify({learner,ready:false,reason:'missing configured Project/thread'}));
    failed=true;
    continue;
  }
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'family-tutor-readiness-'));
  const file=path.join(dir,'input.json');
  try{
    await fs.writeFile(file,JSON.stringify({project_id:binding.project_id,thread_id:binding.thread_id}),{mode:0o600});
    const run=spawnSync(cli,['platform','run','chatgpt','validate','--auto-session','--config',file],{
      encoding:'utf8',timeout:120000,maxBuffer:1024*1024
    });
    if(run.error||run.status!==0) throw new Error('Browser Workspace validation failed');
    const wrapper=JSON.parse(run.stdout.trim().split(/\r?\n/).at(-1));
    if(!wrapper?.result?.ok) throw new Error('ChatGPT platform validation failed');
    const observed=JSON.parse(String(wrapper.result.stdout||'').trim().split(/\r?\n/).at(-1));
    const ready=observed===true;
    console.log(JSON.stringify({learner,ready,reason:ready?undefined:String(observed)}));
    failed ||= !ready;
  }catch(error){
    console.log(JSON.stringify({learner,ready:false,reason:error.message}));
    failed=true;
  }finally{
    await fs.rm(dir,{recursive:true,force:true});
  }
}
if(learners.length===0) failed=true;
process.exitCode=failed?1:0;
