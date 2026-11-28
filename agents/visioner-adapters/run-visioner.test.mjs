import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runVisioner,resolveMarkcutProfile} from './run-visioner.mjs';

test('fresh inference always selects product, preserves exact context and fails closed for offline requests',async t=>{
 const folder=mkdtempSync(join(tmpdir(),'shared-visioner-'));t.after(()=>rmSync(folder,{recursive:true,force:true}));
 writeFileSync(join(folder,'a.mov'),'fixture');
 const calls=[];const execute=async args=>{
   calls.push(args);
   writeFileSync(join(folder,'metadata.json'),JSON.stringify({'a.mov':{normalized:null,orientation:{status:'upright'},perception:{desc:'test',segments:{'0to1000':{description:'test'}}}}}));
 };
 const base={folder,execute,contextText:'context with ` and $()'};
 await assert.rejects(runVisioner(base),/authorized external transfer/);
 assert.equal(calls.length,0);
 const r=await runVisioner({...base,externalTransferAuthorized:true});
 assert.deepEqual(calls[0],['markcut','vision',folder,'--instruct',base.contextText,'--profile',resolveMarkcutProfile('product')]);
 assert.equal(r.markcut.invoked,true);
 assert.equal((await runVisioner(base)).markcut.reused,true);
 assert.equal(calls.length,1);
});

test('Visioner rejects prototype; product profile preserves authorized direct overrides',async t=>{
 const folder=mkdtempSync(join(tmpdir(),'shared-visioner-profile-'));t.after(()=>rmSync(folder,{recursive:true,force:true}));
 writeFileSync(join(folder,'a.png'),'fixture');
 const calls=[];const execute=async args=>{
  calls.push(args);writeFileSync(join(folder,'metadata.json'),JSON.stringify({'a.png':{normalized:null,orientation:{status:'upright'},perception:{desc:'test'}}}));
 };
 const path=resolveMarkcutProfile('product'), config=JSON.parse(readFileSync(path,'utf8'));
 assert.match(config.itt,/agents-relay infer.*--capability vision --input \{input\} --prompt \{prompt_quoted\}/);
 assert.match(config.agent,/agents-relay.*infer.*text.*json.*--prompt \{prompt\}/);
 assert.equal(config.extends,undefined); assert.match(config.stt,/--model turbo/);
 const prototype=JSON.parse(readFileSync(resolveMarkcutProfile('prototype'),'utf8'));
 assert.equal(prototype.extends,'prototype');
 assert.equal(prototype.itt,config.itt); assert.equal(prototype.agent,config.agent);
 for(const inherited of ['tts','vtt','tti','ttv','editCli'])assert.equal(Object.hasOwn(config,inherited),false);
 await assert.rejects(runVisioner({folder,execute,profile:'prototype',externalTransferAuthorized:true}),/requires the product/);
 assert.equal(calls.length,0);
 const options={adapterCommand:['local-vision'],agentCommand:'local-agent {prompt}'};
 await runVisioner({folder,execute,...options});
 assert.deepEqual(calls.at(-1),['markcut','vision',folder,'--profile',path,'--itt',"'local-vision' --input {input} --prompt {prompt_quoted}",'--vtt',"'local-vision' --input {input} --prompt {prompt_quoted} --sample-interval {sample_interval}",'--agent',options.agentCommand]);
});
