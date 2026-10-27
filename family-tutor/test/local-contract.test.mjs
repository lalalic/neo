import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateConfig } from '../scripts/validate-local-config.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

test('lifecycle exposes the fixed commands',()=>{
  const run=spawnSync(path.join(root,'neo-project'),['help'],{encoding:'utf8'});
  assert.equal(run.status,0);
  for(const name of ['setup','start','stop','restart','status','health','uninstall','help']){
    assert.match(run.stdout,new RegExp(name));
  }
});

test('local config rejects Cloudflare and missing child mapping',()=>{
  const config={version:1,discord:{mode:'local',parentChannelId:'parent'},
    children:[{id:'student',name:'Student'}],browserWorkspace:{enabled:true}};
  assert.equal(validateConfig(config),true);
  assert.throws(()=>validateConfig({...config,discord:{...config.discord,mode:'cloudflare'}}),/unsupported/);
  assert.throws(()=>validateConfig({...config,children:[]}),/at least one child/);
});

test('health fails closed when a private config is missing',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'neo-ft-health-'));
  try{
    const run=spawnSync(path.join(root,'neo-project'),['health'],{
      encoding:'utf8',timeout:10000,env:{...process.env,FAMILY_TUTOR_INSTANCE:temp}
    });
    assert.notEqual(run.status,0);
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
