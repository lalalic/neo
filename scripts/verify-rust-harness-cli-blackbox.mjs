#!/usr/bin/env node
/**
 * Rust Neo Harness CLI black-box pre-cutover acceptance (read-only phase).
 *
 * Validates the *CLI executable* via spawn with argv arrays, not Rust APIs.
 * Real-machine probes are read-only and never log private command payloads.
 * All intentionally prepared artifacts live in a disposable fixture HOME.
 * No production Jobs, tokens, device actions, rentals, service restarts or
 * Eval reports are created. Exit nonzero if any acceptance gate fails.
 *
 * Usage: node scripts/verify-rust-harness-cli-blackbox.mjs [--isolated-only]
 * Prerequisite: cargo build --offline -p neo-harness-cli --bin neo-rs
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {chmodSync,existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const rust=join(root,'target/debug/neo-rs');
const node=join(root,'.bin/neo.mjs');
const isolatedOnly=process.argv.slice(2).includes('--isolated-only');
if(process.argv.slice(2).some(a=>a!=='--isolated-only'))throw Error('Usage: --isolated-only');
if(!existsSync(rust)||!existsSync(node))throw Error('Build the Rust Neo CLI and verify the Node reference is present first');
const evidence=[];
const deferred=[
  {area:'Project',commands:'project run (create/resume), setup-agent, tts',reason:'Can create Relay Jobs, open a browser or write audio'},
  {area:'MCP',commands:'mcp call mutating tools, token issue/revoke',reason:'Native app UI effects or credential mutations'},
  {area:'Computer Use',commands:'click/drag/type/set_value',reason:'Controls a real desktop'},
  {area:'Escalation',commands:'test/learn/execute',reason:'Starts a model process or persists private lessons'},
  {area:'Eval',commands:'eval run (including --dry-run)',reason:'Creates report files and may call Relay/Codex'},
  {area:'Compute',commands:'build (without --dry-run), run (without --dry-run), web add/start/stop/token/rotate/remove/serve, cleanup',reason:'Changes local configuration or may rent GPU and upload files'},
  {area:'Service',commands:'start/stop/restart --apply',reason:'Changes production processes'},
  {area:'Distribution',commands:'replace installed neo, publish package',reason:'Alters production version or external package registry'},
];

// Raw argv arrays are mandatory: interactive zsh intentionally does not split
// unquoted variables, which can create false 'unsupported command' results.
function cli(binary,args,{env=process.env,cwd=root,timeout=20000}={}){
  const executable=binary==='node'?process.execPath:binary==='installed'?'neo':binary;
  const argv=binary==='node'?[node,...args]:args;
  const outcome=spawnSync(executable,argv,{cwd,env,encoding:'utf8',timeout,maxBuffer:24*1024*1024});
  return {status:outcome.status,stdout:outcome.stdout||'',stderr:outcome.stderr||'',error:outcome.error?.code||null};
}
function json(result){return JSON.parse(result.stdout)}
function lastJson(result){const start=result.stdout.lastIndexOf('\n{');return JSON.parse(start<0?result.stdout:result.stdout.slice(start+1));}
function ordered(v){
  if(Array.isArray(v))return v.map(ordered);
  if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,ordered(v[k])]));
  return v;
}
function verify(name,fn,scope='isolated'){
  try{fn();evidence.push({name,scope,status:'PASS'});}
  catch(error){
    // JSON parse and deep-equality exceptions can echo private Bootstrap or
    // MCP content. Never include their input text in the failure report.
    const reason=error instanceof SyntaxError?'Invalid structured CLI response':String(error.message).slice(0,350);
    evidence.push({name,scope,status:'FAIL',reason});
  }
}
function success(result){assert.equal(result.error,null,'process launch or timeout failed');assert.equal(result.status,0,'command exit was nonzero')}
function pair(name,args,env,opts={}){
  verify(name,()=>{
    const a=cli('node',args,{env}),b=cli(rust,args,{env});
    success(a);success(b);
    assert.ok(JSON.stringify(ordered(json(a)))===JSON.stringify(ordered(json(b))),
      'Node and Rust JSON contracts differ');
    opts.assert?.(json(b));
  });
}
function onlyRust(name,args,env,assertion){
  verify(name,()=>{const r=cli(rust,args,{env});success(r);assertion?.(json(r));});
}
function reject(name,args,env,pattern){
  verify(name,()=>{
    const r=cli(rust,args,{env});
    assert.equal(r.error,null);
    assert.notEqual(r.status,0,'unsafe/invalid invocation unexpectedly succeeded');
    assert.match(r.stderr,pattern);
  });
}
// Content digest is independent of atime and is sensitive to new files,
// contents and symlink replacement. The harness source and installed Neo
// launcher are never writable targets of these cases.
function treeFingerprint(dir){
  const h=createHash('sha256');
  function walk(p,name){
    for(const entry of readdirSync(p,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
      const rel=join(name,entry.name),full=join(p,entry.name);
      h.update(rel+'\0');
      if(entry.isDirectory())walk(full,rel);
      else if(entry.isFile())h.update(readFileSync(full));
      else if(entry.isSymbolicLink())h.update('SYMLINK:'+readFileSync(full,'utf8'));
      else h.update('SPECIAL');
    }
  }
  walk(dir,'');return h.digest('hex');
}
function fileInventory(base){
  const out=new Map();
  const walk=(dir,relative='')=>{
    for(const item of readdirSync(dir,{withFileTypes:true})){
      const name=join(relative,item.name),file=join(dir,item.name);
      if(item.isDirectory())walk(file,name);
      else if(item.isFile())out.set(name,createHash('sha256').update(readFileSync(file)).digest('hex'));
      else if(item.isSymbolicLink())out.set(name,'LINK');
    }
  };
  walk(base);return out;
}
const temp=mkdtempSync(join(tmpdir(),'neo-rust-blackbox-'));
try{
  const home=join(temp,'home'),workspace=join(temp,'projects'),project=join(workspace,'sample');
  const conf=join(home,'.config/neo/workspace.json');
  mkdirSync(dirname(conf),{recursive:true});mkdirSync(join(home,'.agents/skills'),{recursive:true});
  mkdirSync(join(home,'.local/share/agency-agents/integrations/dsh'),{recursive:true});
  mkdirSync(join(project,'.evals'),{recursive:true});mkdirSync(join(project,'agents'),{recursive:true});
  writeFileSync(join(home,'.agents/AGENTS.md'),'# Synthetic black-box E2E rules\n');
  writeFileSync(conf,JSON.stringify({schemaVersion:1,neoRoot:workspace}));
  writeFileSync(join(project,'AGENTS.md'),'# Disposable Project\n');
  writeFileSync(join(project,'README.md'),'# Project\n');
  writeFileSync(join(project,'graph.mmd'),'flowchart TD\n A[agent:visioner]-->B[agent:editor]\n');
  for(const role of ['visioner','editor'])writeFileSync(join(project,'agents',role+'.agent.md'),'# '+role+'\n');
  writeFileSync(join(project,'.evals/cases.json'),JSON.stringify([
    {id:'plan-first',role:'visioner',capability:'Choose plan',task:'Plan or run?',choices:['plan','run'],expectedDecision:'plan'},
    {id:'edit-first',role:'editor',capability:'Choose edit',task:'Edit or publish?',choices:['edit','publish'],expectedDecision:'edit'}
  ]));
  writeFileSync(join(project,'project.run.json'),JSON.stringify({schemaVersion:1,input:{type:'url',schemes:['https'],resumePath:true}}));
  const init=spawnSync('git',['init','--quiet',project],{encoding:'utf8'});success({status:init.status,error:init.error?.code||null});
  writeFileSync(join(project,'Dockerfile'),'FROM scratch\n');
  for(const args of [
    ['-C',project,'add','Dockerfile'],
    ['-C',project,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-q','-m','Fixture source'],
    ['-C',project,'remote','add','origin','https://github.com/example/fixture.git']
  ]){
    const git=spawnSync('git',args,{encoding:'utf8'});
    success({status:git.status,error:git.error?.code||null});
  }

  const fakeBin=join(temp,'provider-fakes');mkdirSync(fakeBin,{recursive:true});
  for(const executable of ['docker','hf','vastai','gh']){
    const file=join(fakeBin,executable);
    writeFileSync(file,`#!/bin/sh\nprintf '%s\\n' "called" >> "$HOME/unexpected-provider-invocation"\nexit 0\n`);
    // The fake binaries are deliberately executable; doctor may detect them
    // but must not execute any of them.
    chmodSync(file,0o755);
  }
  const env={...process.env,PYTHONDONTWRITEBYTECODE:'1',PATH:fakeBin+':'+process.env.PATH,HOME:home,NEO_ROOT:workspace,NEO_HARNESS_ROOT:root,NEO_WORKSPACE_CONFIG:conf,
    NEO_GPU_REGISTRY_FILE:join(home,'.config/neo/gpu/services.json'),NEO_GPU_STATE_DIR:join(home,'.local/state/neo/gpu'),
    NEO_ESCALATION_CASES_DIR:join(home,'.local/share/neo/escalation/cases'),
    NEO_ESCALATION_CHALLENGES_DIR:join(home,'.local/share/neo/escalation/challenges')};
  // Isolated, write-once staging is set up BEFORE the readonly snapshot.
  const stage=join(temp,'stage');
  verify('native distribution stages from committed assets',()=>{
    const r=cli(rust,['package','stage',stage],{env});success(r);
    const v=json(r);assert.equal(v.productionInstall,false);
    assert.ok(existsSync(join(stage,'bin/neo')));
    assert.ok(!existsSync(join(stage,'skills/iphone-helm')));
    assert.ok(!existsSync(join(stage,'skills/neo-use')));
  });
  const before=treeFingerprint(home)+treeFingerprint(workspace);
  const originalHome=fileInventory(home),originalProject=fileInventory(workspace);
  pair('workspace show (fixture)', ['workspace','show'],env);
  pair('project list (fixture)', ['project','list'],env,{assert:rows=>assert.equal(rows.length,1)});
  pair('project resolve (fixture)', ['project','resolve','sample'],env);
  pair('agent list shared (fixture)', ['agent','list','--source','shared'],env);
  pair('agent semantic search (fixture)', ['agent','search','visioner','--limit','3'],env);
  pair('skill list (fixture)', ['skill','list'],env,{assert:rows=>{
    assert.ok(rows.some(x=>x.name==='neo-project'));
    assert.ok(!rows.some(x=>x.name==='iphone-helm'||x.name==='neo-use'));
  }});
  pair('skill list project scope (fixture)', ['skill','list','--project',project],env);
  pair('bootstrap JSON (fixture)', ['bootstrap','--json'],env);
  pair('eval list (fixture)', ['eval','list','--project','sample'],env,{assert:obj=>assert.equal(obj.cases.length,2)});
  // The retired Node Eval DAG path imports the removed Node Relay graph parser.
  // Validate native Rust's DAG selection as a standalone black-box contract.
  onlyRust('eval DAG list native (fixture)', ['eval','list','--project','sample','--dag'],env,o=>{
    assert.deepEqual(o.dagRoles,['visioner','editor']);assert.equal(o.cases.length,2);
  });
  verify('eval audit read-only (fixture)',()=>{
    const result=cli(rust,['eval','audit'],{env});
    assert.equal(result.error,null);assert.ok([0,1].includes(result.status));
    const summary=lastJson(result);
    assert.equal(summary.projects,1);
    assert.equal(summary.roles,2);
  });
  pair('escalation cases empty (fixture)', ['escalation','cases'],env,{assert:rows=>assert.equal(rows.length,0)});
  pair('escalation challenges empty (fixture)', ['escalation','challenges'],env,{assert:rows=>assert.equal(rows.length,0)});
  pair('compute services empty (fixture)', ['compute','services'],env,{assert:obj=>assert.equal(Object.keys(obj.services).length,0)});
  onlyRust('compute doctor detects providers without executing them', ['compute','doctor'],env,o=>{
    assert.equal(o.native,'rust');assert.equal(o.hfCli,true);assert.equal(o.vastCli,true);
    assert.equal(o.githubCli,true);assert.equal(o.localContainerRuntime,true);
    assert.ok(!existsSync(join(home,'unexpected-provider-invocation')));
  });
  onlyRust('compute web status empty (fixture)', ['compute','web','status'],env,o=>assert.deepEqual(o,{}));
  onlyRust('compute build dry-run skips Docker and GH', ['compute','build','--project',project,
    '--builder','github','--no-push','--dry-run'],env,o=>{
      assert.equal(o.builder,'github');assert.equal(o.push,false);
      assert.equal(o.mode,'batch');assert.match(o.image,/^ghcr\.io\//);
      assert.ok(!existsSync(join(home,'unexpected-provider-invocation')));
    });
  reject('compute build rejects conflicting push flags', ['compute','build','--project',project,
    '--push','--no-push','--dry-run'],env,/conflict/i);
  onlyRust('compute run plan only (fixture)', ['compute','run','--image','ghcr.io/example/fixture:v1',
    '--provider','hf','--output','output='+join(temp,'result.bin'),'--dry-run'],env,o=>{
      assert.equal(o.mode,'dry_run');assert.equal(o.allowSpend,false);
    });
  // Dry-run is a read operation: prove no private Run and no Relay binding.
  pair('project run dry-run (fixture)', ['project','run','--url','https://example.org/fixture','--project','sample','--dry-run'],env,
    {assert:o=>assert.equal(o.dryRun,true)});
  reject('project run rejects obsolete caller preflight', ['project','run','--project','sample','--preflight=false'],env,/unknown project run option/);
  reject('project run rejects obsolete duplicate preflight', ['project','run','--project','sample','--preflight=true','--preflight=true'],env,/unknown project run option/);
  reject('eval rejects invalid DAG flag', ['eval','list','--project','sample','--smoke'],env,/--smoke requires --dag/);
  reject('eval rejects profile without model', ['eval','list','--project','sample','--profile','neo'],env,/requires --model/);
  reject('compute rejects unsupported provider', ['compute','run','--image','ghcr.io/example/fixture:v1','--provider','invalid',
    '--output','output='+join(temp,'result.bin'),'--dry-run'],env,/Provider must be hf or vast/);
  reject('compute cannot rent without explicit authorization', ['compute','run','--image','ghcr.io/example/fixture:v1',
    '--output','output='+join(temp,'result.bin')],env,/requires --allow-spend/);
  reject('compute web rejects unknown service without rental', ['compute','web','status','missing'],env,/Unknown|not found|No Web/i);
  reject('obsolete gpu alias fails closed', ['gpu','services'],env,/obsolete|removed/i);
  reject('service malformed status rejected before PM2', ['service','status','../bad'],env,/invalid service name/i);
  reject('service malformed list rejected before PM2', ['service','list','--apply'],env,/usage/i);
  reject('service mutation requires apply before PM2 interrogation', ['service','restart','fixture-service'],env,/--apply|usage|unknown/i);
  verify('no persistent changes in isolated HOME or Project',()=>{
    const changes=[];
    for(const [kind,base,prior] of [['HOME',home,originalHome],['Project',workspace,originalProject]]){
      const current=fileInventory(base);
      for(const key of new Set([...prior.keys(),...current.keys()])){
        if(prior.get(key)!==current.get(key))changes.push(kind+':'+key);
      }
    }
    assert.deepEqual(changes,[],`CLI operations changed fixture files: ${changes.join(', ')}`);
    assert.equal(treeFingerprint(home)+treeFingerprint(workspace),before);
    assert.ok(!existsSync(join(project,'runs')));
    assert.ok(!existsSync(join(project,'.evals/reports')));
    assert.ok(!existsSync(join(home,'.local/state/neo/gpu')));
  });
  verify('staged CLI bootstrap / inventory (no source mutation)',()=>{
    const e={...env};delete e.NEO_HARNESS_ROOT;
    const boot=cli(join(stage,'bin/neo'),['bootstrap','--json'],{env:e,timeout:45000});success(boot);
    assert.ok(json(boot).agentRules.includes('Synthetic black-box E2E rules'));
    const skills=cli(join(stage,'bin/neo'),['skill','list'],{env:e,timeout:45000});success(skills);
    assert.ok(!json(skills).some(s=>s.name==='iphone-helm'||s.name==='neo-use'));
  });
  verify('opt-in global Skill discovery without core bundle mutation',()=>{
    const external=join(temp,'independent-iphone-helm');mkdirSync(external,{recursive:true});
    writeFileSync(join(external,'SKILL.md'),'---\nname: iphone-helm\ndescription: Optional physical iPhone QA.\n---\n# QA\n');
    const link=join(home,'.agents/skills/iphone-helm');symlinkSync(external,link);
    try{
      const added=cli(rust,['skill','list'],{env});success(added);
      assert.ok(json(added).some(s=>s.name==='iphone-helm'));
      assert.ok(!existsSync(join(stage,'skills/iphone-helm')));
    } finally {rmSync(link)}
    assert.ok(!json(cli(rust,['skill','list'],{env})).some(s=>s.name==='iphone-helm'));
  });

  if(!isolatedOnly){
    // Call the established 14 live parity cases. They compare Node and Rust
    // against the *same* production Neo.app endpoint but perform no writes.
    verify('14 existing live read-only Node↔Rust command contracts',()=>{
      const r=cli(process.execPath,['scripts/verify-rust-harness-readonly.mjs'],{env:process.env});
      success(r);const report=json(r);assert.equal(report.total,14);assert.equal(report.passes,14);
    },'live');
    const live={...process.env};
    // Compare with the *installed* production Node CLI as well as the source
    // reference. Run from a neutral directory: otherwise the older installed
    // Agent resolver can classify this independent Rust worktree as a Project.
    // The two package installations must differ in their own Harness root.
    const productionCwd=temp;
    verify('installed Node CLI resolves native Harness root',()=>{
      const old=cli('installed',['workspace','show'],{env:live,cwd:productionCwd});
      const current=cli(rust,['workspace','show'],{env:live,cwd:productionCwd});
      success(old);success(current);
      assert.ok(json(old).harnessRoot!==json(current).harnessRoot);
    },'installed');
    const production=cli('installed',['workspace','show'],{env:live,cwd:productionCwd});
    const native=cli(rust,['workspace','show'],{env:live,cwd:productionCwd});
    if(production.status===0&&native.status===0){
      const oldRoot=json(production).harnessRoot,newRoot=json(native).harnessRoot;
      const canon=v=>JSON.stringify(ordered(v)).replaceAll(oldRoot,'<HARNESS_ROOT>').replaceAll(newRoot,'<HARNESS_ROOT>');
      for(const args of [
        ['workspace','show'],['project','list'],['agent','list'],
        ['agent','list','--source','shared'],['skill','list'],
        ['bootstrap','--json'],['mcp','tools'],['status'],['doctor']
      ]){
        verify('installed Node↔Rust '+args.join(' '),()=>{
          const a=cli('installed',args,{env:live,cwd:productionCwd});
          const b=cli(rust,args,{env:live,cwd:productionCwd});
          success(a);success(b);
          assert.ok(canon(json(a))===canon(json(b)),'Installed Node and Rust contracts differ');
        },'installed');
      }
    }

    const projectList=cli(rust,['project','list'],{env:live});
    verify('live Project discovery is available (read only)',()=>{success(projectList);assert.ok(Array.isArray(json(projectList)))},'live');
    if(projectList.status===0&&json(projectList).length){
      const sample=json(projectList)[0];
      for(const [name,args] of [
        ['project resolve',['project','resolve',sample.name]],
        ['agent list agency',['agent','list','--source','agency']],
        ['skill list project scope',['skill','list','--project',sample.local_path]],
        ['bootstrap JSON project scope',['bootstrap','--json','--project',sample.local_path]],
      ]){
        verify('live '+name+' parity',()=>{
          const a=cli('node',args,{env:live}),b=cli(rust,args,{env:live});
          success(a);success(b);
          assert.ok(JSON.stringify(ordered(json(a)))===JSON.stringify(ordered(json(b))),
            'Node and Rust JSON contracts differ');
        },'live');
      }
    }
    // Escalation history contains private data: verify only exit/shape,
    // never print content. Do not invoke escalation test/learn/execute.
    for(const noun of ['cases','challenges']){
      verify('live escalation '+noun+' read-only query',()=>{
        const r=cli(rust,['escalation',noun,'--limit','1'],{env:live});success(r);assert.ok(Array.isArray(json(r)));
      },'live');
    }
    onlyRustLive('compute services read-only', ['compute','services'],v=>assert.ok(v.services&&typeof v.services==='object'));
    onlyRustLive('compute doctor read-only', ['compute','doctor'],v=>assert.equal(v.native,'rust'));
    verify('live Computer Use list_apps is read-only (Node↔Rust)',()=>{
      const args=['computer-use','call','list_apps'];
      for(const binary of ['node',rust]){
        const result=cli(binary,args,{env:live});success(result);
        const reply=json(result);assert.equal(reply.isError,false);assert.ok(reply.content?.length>0);
      }
    },'live');
    verify('live Eval audit scans without creating reports',()=>{
      const result=cli(rust,['eval','audit'],{env:live,timeout:30000});
      assert.equal(result.error,null);assert.ok([0,1].includes(result.status));
      const audit=lastJson(result);assert.ok(audit.projects>=1);assert.ok(audit.roles>=0);
    },'live');
    verify('live service status is read-only',()=>{
      const inventory=cli(rust,['service','list'],{env:live});success(inventory);
      const name=json(inventory)[0]?.name;assert.ok(name);
      const status=cli(rust,['service','status',name],{env:live});success(status);
      assert.equal(json(status).name,name);
    },'live');
    function onlyRustLive(name,args,fn){verify('live '+name,()=>{const r=cli(rust,args,{env:live});success(r);fn(json(r));},'live')}
  }
} finally {rmSync(temp,{recursive:true,force:true});}
const passed=evidence.filter(x=>x.status==='PASS').length;
const report={schemaVersion:1,scope:'readonly-blackbox-cli',passed,total:evidence.length,
  failed:evidence.filter(x=>x.status==='FAIL'),cases:evidence.map(x=>({name:x.name,scope:x.scope,status:x.status})),
  deferred};
console.log(JSON.stringify(report,null,2));
if(passed!==evidence.length)process.exitCode=1;
