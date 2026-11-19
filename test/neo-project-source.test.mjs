import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runProject, resolveProjectSource} from '../.bin/neo-project-run.mjs';

const sources = {
 'saved-notes': {dag:'growth',config:'config/saved-notes.json',runFile:'research-brief.json'}
};
function fixture(t) {
 const base=mkdtempSync(join(tmpdir(),'neo-project-source-'));
 t.after(()=>rmSync(base,{recursive:true,force:true}));
 const neoRoot=join(base,'workspace','neo');
 const mk=(name,decl)=>{
  const folder=join(neoRoot,name);
  mkdirSync(join(folder,'config'),{recursive:true});
  writeFileSync(join(folder,'AGENTS.md'),'# project');
  writeFileSync(join(folder,'README.md'),'# project');
  writeFileSync(join(folder,'graph.mmd'),'flowchart TD\n  a[agent:start] --> b[agent:end]\n');
  writeFileSync(join(folder,'graph-growth.mmd'),'flowchart TD\n  r[agent:researcher] --> e[agent:editor]\n');
  writeFileSync(join(folder,'project.run.json'),JSON.stringify(decl));
  execFileSync('git',['init','-q',folder]);
  return folder;
 };
 const alpha=mk('alpha',{schemaVersion:1,input:{type:'url',schemes:['https'],resumePath:true,preparedPath:true},
  graphs:{promotion:'graph.mmd',growth:'graph-growth.mmd'},defaultDag:'promotion',dagInputs:{growth:{type:'discovery'}},sources});
 writeFileSync(join(alpha,'config/saved-notes.json'),JSON.stringify({schemaVersion:1,mode:'collections',limit:45,threshold:1000}));
 const beta=mk('beta',{schemaVersion:1,input:{type:'url',schemes:['https'],resumePath:true,preparedPath:true},
  graphs:{promotion:'graph.mmd',growth:'graph-growth.mmd'},defaultDag:'promotion',dagInputs:{growth:{type:'discovery'}},
  sources:{'company-feed':{dag:'growth',config:'config/feed.json',runFile:'feed-brief.json'}}});
 writeFileSync(join(beta,'config/feed.json'),JSON.stringify({schemaVersion:1,mode:'company-feed',queries:['press release']}));
 const calls=[],jobs=new Map(),tasks=new Map(),failures=new Set();
 const relay={calls,failures,tasks,runRelay(args){
  calls.push(args);
  const key=args.slice(0,2).join(':');
  if(failures.has(key))throw Error('mock '+key+' failure');
  const at=flag=>args[args.indexOf(flag)+1];
  if(key==='job:create'){
   const job=String(jobs.size+101),repo=at('--repo');
   const task={id:'17',input:readFileSync(at('--coordinator-input-file'),'utf8'),agentGraph:readFileSync(at('--coordinator-graph-file'),'utf8'),
     output:{kind:'file',path:at('--coordinator-output-path')}};
   jobs.set(job,{id:job,repository:repo,projectRoot:at('--project-root'),state:'DRAFT'});
   tasks.set(job,[task]);
   return {job,taskId:'17',state:'DRAFT'};
  }
  if(key==='job:show')return jobs.get(at('--id'));
  if(key==='task:list')return {tasks:tasks.get(at('--id'))};
  if(key==='job:run'){jobs.get(at('--id')).state='ACTIVE';return {state:'ACTIVE',scheduled:true};}
  throw Error('unexpected command '+args.join(' '));
 }};
 const workspace={neoRoot,harnessRoot:join(base,'harness')};
 async function run(args){
  const output=[];
  await runProject(args,{workspace,runRelay:relay.runRelay,emit:x=>output.push(x),now:new Date('2026-11-19T12:00:00Z')});
  return JSON.parse(output[0]);
 }
 return {base,neoRoot,alpha,beta,relay,run};
}
const read=(run,file)=>readFileSync(join(run,file),'utf8');
const setDeclaration=(project,fn)=>{
 const file=join(project,'project.run.json'),decl=JSON.parse(readFileSync(file,'utf8'));
 fn(decl);writeFileSync(file,JSON.stringify(decl));
};

test('source presets are project-owned and a dry run validates without creating any Run',async t=>{
 const f=fixture(t);
 const x=await f.run(['--project','alpha','--source','saved-notes','--dry-run']);
 assert.equal(x.dag,'growth');assert.equal(x.source,'saved-notes');assert.equal(x.sourceBrief,'research-brief.json');
 assert.equal(x.inputType,'discovery');assert.equal(existsSync(join(f.alpha,'runs')),false);
 assert.equal(f.relay.calls.length,0);
 const y=await f.run(['--project','beta','--source=company-feed','--dry-run']);
 assert.equal(y.source,'company-feed');assert.equal(y.sourceBrief,'feed-brief.json');
 await assert.rejects(f.run(['--project','beta','--source','saved-notes','--dry-run']),/unknown or unconfigured project source/);
});

test('new source Run stages only its declared private brief; Coordinator receives that exact source',async t=>{
 const f=fixture(t);
 const created=await f.run(['--project','alpha','--source=saved-notes']);
 assert.equal(created.jobId,'101');assert.equal(created.dag,'growth');assert.equal(created.source,'saved-notes');
 assert.equal(created.status,'ACTIVE');
 assert.equal(statSync(created.runPath).mode & 0o777,0o700);
 const brief=JSON.parse(read(created.runPath,'research-brief.json'));
 assert.deepEqual(brief,{schemaVersion:1,mode:'collections',limit:45,threshold:1000});
 assert.equal(statSync(join(created.runPath,'research-brief.json')).mode & 0o777,0o600);
 const reference=JSON.parse(read(created.runPath,'source-reference.json'));
 assert.equal(reference.kind,'discovery');assert.equal(reference.source,'saved-notes');
 assert.equal(reference.sourceBrief,'research-brief.json');
 assert.match(read(created.runPath,'neo-project-run.input.md'),/Selected project source: saved-notes/);
 assert.match(read(created.runPath,'neo-project-run.objective.md'),/instead of the default discovery strategy/);
 assert.doesNotMatch(read(created.runPath,'neo-project-run.input.md'),/independently search public trending videos/);
 assert.match(f.relay.tasks.get('101')[0].agentGraph,/agent:researcher/);
 assert.equal(f.relay.calls.filter(x=>x[1]==='create').length,1);
 const resumed=await f.run(['--project','alpha','--path',created.runPath]);
 assert.equal(resumed.jobId,'101');assert.equal(f.relay.calls.filter(x=>x[1]==='create').length,1);
 assert.equal(read(created.runPath,'research-brief.json'),JSON.stringify(brief,null,2)+'\n');
});

test('unbound private source Run recovers after Relay creation failure and rejects changed source evidence',async t=>{
 const f=fixture(t);
 f.relay.failures.add('job:create');
 await assert.rejects(f.run(['--project','alpha','--source','saved-notes']),/mock job:create failure/);
 const runPath=join(f.alpha,'runs',readdirSync(join(f.alpha,'runs'))[0]);
 assert.equal(existsSync(join(runPath,'research-brief.json')),true);
 assert.equal(existsSync(join(runPath,'.neo-project-run.json')),false);
 f.relay.failures.clear();
 const recovered=await f.run(['--project','alpha','--path',runPath]);
 assert.equal(recovered.jobId,'101');assert.equal(read(runPath,'source-reference.json').includes('saved-notes'),true);
 const g=fixture(t);
 g.relay.failures.add('job:create');
 await assert.rejects(g.run(['--project','alpha','--source','saved-notes']));
 const tampered=join(g.alpha,'runs',readdirSync(join(g.alpha,'runs'))[0]);
 writeFileSync(join(tampered,'research-brief.json'),JSON.stringify({schemaVersion:1,mode:'modified'}));
 g.relay.failures.clear();
 await assert.rejects(g.run(['--project','alpha','--path',tampered]),/different or insecure/);
 assert.equal(g.relay.calls.filter(x=>x[1]==='create').length,1);
});

test('source rejects unsupported flags, mismatched DAG and missing discovery without side effects',async t=>{
 const f=fixture(t);
 for(const args of [
  ['--source','saved-notes','--url','https://example.org/'],
  ['--source','saved-notes','--path','/tmp/some-run'],
  ['--source','bad/name'],
  ['--source','saved-notes','--source','saved-notes'],
  ['--source','missing'],
  ['--source','saved-notes','--dag','promotion']]){
   await assert.rejects(f.run(['--project','alpha',...args,'--dry-run']));
 }
 setDeclaration(f.alpha,d=>{delete d.dagInputs.growth;});
 await assert.rejects(f.run(['--project','alpha','--source','saved-notes','--dry-run']),/discovery-enabled DAG|requires --url/);
 assert.equal(existsSync(join(f.alpha,'runs')),false);
 assert.equal(f.relay.calls.length,0);
});

test('source config is bounded by project and rejects traversal, symlink escape and invalid JSON',async t=>{
 const f=fixture(t);
 const verify=async()=>f.run(['--project','alpha','--source','saved-notes','--dry-run']);
 setDeclaration(f.alpha,d=>{d.sources['saved-notes'].config='../other.json';});
 await assert.rejects(verify(),/invalid project source declaration/);
 setDeclaration(f.alpha,d=>{d.sources['saved-notes'].config='config/other.json';});
 await assert.rejects(verify(),/config not found/);
 symlinkSync('/etc/passwd',join(f.alpha,'config/other.json'));
 await assert.rejects(verify(),/escapes project/);
 setDeclaration(f.alpha,d=>{d.sources['saved-notes'].config='config/saved-notes.json';d.sources['saved-notes'].runFile='../evil.json';});
 await assert.rejects(verify(),/invalid project source declaration/);
 setDeclaration(f.alpha,d=>{d.sources['saved-notes'].runFile='research-brief.json';});
 writeFileSync(join(f.alpha,'config/saved-notes.json'),'invalid-json');
 await assert.rejects(verify(),/invalid project source config/);
 assert.equal(existsSync(join(f.alpha,'runs')),false);
});
