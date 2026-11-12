import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {graphAgents,loadRecipe,route} from './route.mjs';

function fixture(kind='mobile'){
  const root=mkdtempSync(join(tmpdir(),'neo-quick-proto-'));
  const run=join(root,'runs','2026-11-12-quick-bear');
  mkdirSync(join(root,'config'));
  mkdirSync(run,{recursive:true});
  const graph='flowchart TD\n  a[agent:toy3d-visioner] --> b[agent:toy3d-builder]\n  b --> c[agent:toy3d-deliverer]\n';
  writeFileSync(join(root,'graph.mmd'),graph);
  writeFileSync(join(root,'README.md'),'# Demo');
  writeFileSync(join(root,'AGENTS.md'),'# Demo');
  writeFileSync(join(root,'config/product-prototype.json'),JSON.stringify({
    schemaVersion:1,product:{name:'demo',kind},
    qa:{transport:kind==='mobile'?'neouse':'webhelm',toolPrefix:'toy3d.'},
    stages:{'toy3d-builder':{prototype:{executor:'script',
      entrypoint:'scripts/try.mjs'},preferredTarget:'service'}}
  }));
  const agent='toy3d-builder';
  const input={project:root,run,agent};
  const set=state=>writeFileSync(join(run,'.product-prototype-gates.json'),
    JSON.stringify({schemaVersion:1,agents:{[agent]:state}}));
  return {root,run,agent,input,set,cleanup:()=>rmSync(root,{recursive:true,force:true})};
}
const tried=(iteration=1)=>({prototype:{status:'tried',iteration}});
const approved=(iteration=1)=>({...tried(iteration),
  ownerReview:{decision:'approved',iteration,notes:'Looks good, implement this'}});
const ported=(iteration=1)=>({...approved(iteration),
  productImplementation:{status:'working',target:'service',iteration}});
const tested=(kind='mobile',iteration=1)=>({...ported(iteration),
  productE2E:{status:'passed',iteration,tool:'toy3d.builder.run',
    transport:kind==='mobile'?'neouse':'webhelm'}});

test('Only canonical graph Agent names are recognized, including terminal RHS Agent',()=>{
  const f=fixture();
  try{
    assert.deepEqual(graphAgents(readFileSync(join(f.root,'graph.mmd'),'utf8')),
      ['toy3d-visioner','toy3d-builder','toy3d-deliverer']);
    assert.equal(loadRecipe(f.root).agents.length,3);
    assert.throws(()=>route({...f.input,agent:'toy3d-benchmarker'}),/not in graph/);
  }finally{f.cleanup()}
});
test('Fresh shortcut calls prototype first with no SHA, Git, review or media prerequisites',()=>{
  const f=fixture();
  try{
    const result=route(f.input);
    assert.equal(result.step,'prototype');
    assert.equal(result.status,'try_prototype');
    assert.equal(result.next.entrypoint,'scripts/try.mjs');
    assert.equal(result.next.executor,'script');
  }finally{f.cleanup()}
});
test('Brief prototype notes are enough to discuss before implementation',()=>{
  const f=fixture();
  try{
    f.set({prototype:{status:'tried',notes:'A small live browser demo; no persisted file'}});
    const result=route(f.input);
    assert.equal(result.step,'confirm');
    assert.equal(result.status,'discuss_with_user');
    assert.match(result.next.action,/natural chat confirmation/i);
  }finally{f.cleanup()}
});
test('User changes request returns to rapid prototype, with feedback and no formal Review required',()=>{
  const f=fixture();
  try{
    f.set({...tried(),ownerReview:{decision:'changes_requested',notes:'Make eyes smaller'}});
    const result=route(f.input);
    assert.equal(result.step,'prototype');
    assert.equal(result.status,'revise_prototype');
    assert.equal(result.next.feedback,'Make eyes smaller');
  }finally{f.cleanup()}
});
test('Conversational acceptance moves to port, native/API work then actual product E2E',()=>{
  const f=fixture();
  try{
    f.set(approved());
    assert.equal(route(f.input).step,'port');
    assert.equal(route(f.input).next.target,'service');
    f.set(ported());
    const result=route(f.input);
    assert.equal(result.step,'product-e2e');
    assert.equal(result.next.transport,'neouse');
    assert.equal(result.next.tool,'toy3d.builder.run');
    f.set(tested());
    assert.equal(route(f.input).step,'ready');
  }finally{f.cleanup()}
});
test('Website follows the same flow but tests the real website with WebHelm',()=>{
  const f=fixture('web');
  try{
    f.set(ported());assert.equal(route(f.input).next.transport,'webhelm');
    f.set(tested('web'));assert.equal(route(f.input).step,'ready');
  }finally{f.cleanup()}
});
test('Lightweight iteration markers can invalidate old approvals and stale E2E',()=>{
  const f=fixture();
  try{
    f.set({...tested(),prototype:{status:'tried',iteration:2}});
    assert.equal(route(f.input).step,'confirm');
    f.set({...tested(),prototype:{status:'tried',iteration:2},
      ownerReview:{decision:'approved',iteration:2}});
    assert.equal(route(f.input).step,'port');
    f.set({...ported(2),productE2E:{status:'passed',iteration:1,
      tool:'toy3d.builder.run',transport:'neouse'}});
    assert.equal(route(f.input).step,'product-e2e');
  }finally{f.cleanup()}
});
test('QA result must reference the actual expected tool and transport',()=>{
  const f=fixture();
  try{
    f.set({...tested(),productE2E:{status:'passed',tool:'fake.mock.run',transport:'neouse'}});
    assert.equal(route(f.input).step,'product-e2e');
    f.set({...tested(),productE2E:{status:'passed',tool:'toy3d.builder.run',transport:'webhelm'}});
    assert.equal(route(f.input).step,'product-e2e');
  }finally{f.cleanup()}
});
test('Wrong QA target config and Run path outside owning project fail closed',()=>{
  const f=fixture();
  const outside=mkdtempSync(join(tmpdir(),'prototype-outside-'));
  try{
    assert.throws(()=>route({...f.input,run:outside}),/canonical private product Run/);
    const p=join(f.root,'config/product-prototype.json');
    const c=JSON.parse(readFileSync(p));c.qa.transport='webhelm';
    writeFileSync(p,JSON.stringify(c));
    assert.throws(()=>route(f.input),/Invalid product QA/);
  }finally{f.cleanup();rmSync(outside,{recursive:true,force:true})}
});
