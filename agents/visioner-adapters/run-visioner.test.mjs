import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runVisioner,inferenceArgs} from './run-visioner.mjs';

test('fresh inference passes generic Markcut hooks, preserves exact context and fails closed for offline requests',async t=>{
 const folder=mkdtempSync(join(tmpdir(),'shared-visioner-'));t.after(()=>rmSync(folder,{recursive:true,force:true}));
 writeFileSync(join(folder,'a.mov'),'fixture');
 const calls=[];const execute=async args=>{
   calls.push(args);
   writeFileSync(join(folder,'metadata.json'),JSON.stringify({'a.mov':{normalized:null,perception:{desc:'test',segments:{'0to1000':{description:'test'}}}}}));
 };
 const base={folder,execute,contextText:'context with ` and $()'};
 await assert.rejects(runVisioner(base),/authorized external transfer/);
 assert.equal(calls.length,0);
 const r=await runVisioner({...base,externalTransferAuthorized:true});
 assert.deepEqual(calls[0],['markcut','vision',folder,'--instruct',base.contextText,...inferenceArgs()]);
 assert.match(calls[0][calls[0].indexOf('--itt')+1],/codex-infer\.mjs/);
 assert.match(calls[0][calls[0].indexOf('--agent')+1],/codex-infer\.mjs.*--text --prompt \{prompt\}/);
 assert.ok(!calls[0].includes("--vtt"));
 assert.equal(r.markcut.invoked,true);
 assert.equal((await runVisioner(base)).markcut.reused,true);
 assert.equal(calls.length,1);
});
