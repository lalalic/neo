#!/usr/bin/env node
/**
 * Controlled-write CLI acceptance. All writes are under a disposable fixture,
 * except a loopback in-memory MCP server which never touches the real Neo.app.
 * Real installed Rust Relay PromptBuilder is invoked only with fixture input.
 * The independent Rust Relay Project Run E2E uses its own isolated SQLite.
 * No production Relay Job/Project, Cloud GPU, credentials, or browser is used.
 */
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
import {chmodSync,existsSync,readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync,symlinkSync,statSync,readdirSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const native=join(root,'target/debug/neo-rs');
const nodeReference=join(root,'.bin/neo.mjs');
const relay=process.env.NEO_BLACKBOX_RELAY_BINARY||join(process.env.HOME||'', '.local/share/agents-relay/live/bin/agents-relay-rust');
const relaySource=process.env.NEO_BLACKBOX_RELAY_SOURCE||'/Users/chengli/Workspace/agents-relay';
assert(existsSync(native),'Build the native Rust Neo CLI first');
assert(existsSync(relay),'Installed Rust Relay PromptBuilder is needed');
const cases=[];
const observations=[];
const temp=mkdtempSync(join(tmpdir(),'neo-rust-write-blackbox-'));
let server;
function run(exe,args,{env,timeout=30000,cwd=root}={}){
  return new Promise(resolveDone=>{
    let out='',err='',overflow=false;
    const child=spawn(exe,args,{cwd,env:env||process.env,stdio:['ignore','pipe','pipe']});
    const deadline=setTimeout(()=>child.kill('SIGKILL'),timeout);
    for(const [stream,tag] of [[child.stdout,'stdout'],[child.stderr,'stderr']])stream.on('data',d=>{
      if(tag==='stdout')out+=d.toString();else err+=d.toString();
      if(out.length+err.length>8*1024*1024){overflow=true;child.kill('SIGKILL')}
    });
    child.once('error',e=>{clearTimeout(deadline);resolveDone({code:-1,stdout:out,stderr:err,error:e.code})});
    child.once('close',code=>{clearTimeout(deadline);resolveDone({code:overflow?-2:code,stdout:out,stderr:err})});
  });
}
const cli=(args,env,cwd)=>run(native,args,{env,cwd:cwd||root});
function ok(r){assert.equal(r.code,0,'CLI returned a nonzero status')}
function failed(r){assert.notEqual(r.code,0,'Expected safe CLI rejection')}
function obj(r){return JSON.parse(r.stdout)}
async function verify(name,action){
  try{await action();cases.push({name,status:'PASS'})}
  catch(error){
    // Never echo prompt content, authentication tokens, or private tool JSON.
    cases.push({name,status:'FAIL',reason:error instanceof SyntaxError?'Malformed CLI JSON':String(error.message).slice(0,220)});
  }
}
function git(args,cwd){
  const r=spawnSync('git',args,{cwd,encoding:'utf8'});
  assert.equal(r.status,0,'Disposable Git fixture failed');
}
function isPrivate(path,mode){assert.equal(statSync(path).mode&0o777,mode)}
try{
  const home=join(temp,'home'),workspace=join(temp,'projects'),project=join(workspace,'sample');
  const fakeBin=join(temp,'bin');
  mkdirSync(fakeBin,{recursive:true});mkdirSync(join(home,'.agents'),{recursive:true});
  mkdirSync(join(home,'.config/neo'),{recursive:true});
  mkdirSync(join(home,'Library/Application Support/NeoY'),{recursive:true});
  mkdirSync(join(project,'.evals'),{recursive:true});
  mkdirSync(join(project,'agents'),{recursive:true});
  writeFileSync(join(home,'.agents/AGENTS.md'),'# Synthetic test rules\n');
  writeFileSync(join(home,'.config/neo/workspace.json'),JSON.stringify({schemaVersion:1,neoRoot:workspace}));
  writeFileSync(join(project,'AGENTS.md'),'# Project policy\n');
  writeFileSync(join(project,'README.md'),'# Sample project\n');
  writeFileSync(join(project,'graph.mmd'),'flowchart TD\n A[agent:visioner] --> B[agent:editor]\n');
  writeFileSync(join(project,'agents/visioner.agent.md'),'# Visioner role\n');
  writeFileSync(join(project,'agents/editor.agent.md'),'# Editor role\n');
  writeFileSync(join(project,'.evals/cases.json'),JSON.stringify([
    {id:'choose-plan',role:'visioner',capability:'Choose plan',task:'Plan or execute?',choices:['plan','execute'],expectedDecision:'plan'},
    {id:'js-workload',role:'editor',capability:'Execute local Node test',type:'node-tests',testFiles:['test/local.test.mjs']}
  ]));
  mkdirSync(join(project,'test'),{recursive:true});
  writeFileSync(join(project,'test/local.test.mjs'),"import test from 'node:test';import assert from 'node:assert/strict';test('local only',()=>assert.equal(1+1,2));\n");
  git(['init','-q'],project);
  for(const p of ['docker','hf','vastai','gh']){
    const exe=join(fakeBin,p);
    writeFileSync(exe,'#!/bin/sh\nprintf "provider command invoked" >> "$HOME/provider-called"\nexit 99\n');
    chmodSync(exe,0o755);
  }
  const env={...process.env,HOME:home,NEO_HARNESS_ROOT:root,NEO_ROOT:workspace,
    NEO_WORKSPACE_CONFIG:join(home,'.config/neo/workspace.json'),
    NEO_RELAY_EXECUTABLE:relay,AGENTS_RELAY_WORKSPACE_ROOT:workspace,
    NEO_MCP_OPERATOR_TOKEN_FILE:join(home,'operator-dummy'),
    NEO_GPU_REGISTRY_FILE:join(home,'.config/neo/gpu/services.json'),
    NEO_GPU_WEB_DIR:join(home,'.config/neo/gpu/web'),
    NEO_GPU_WEB_SESSIONS:join(home,'.local/state/neo/gpu/web'),
    NEO_GPU_STATE_DIR:join(home,'.local/state/neo/gpu'),
    NEO_COMPUTE_WEB_ORIGIN:'https://fixture.invalid',
    PYTHONDONTWRITEBYTECODE:'1',PATH:fakeBin+':'+process.env.PATH};

  await verify('Skill ZIP preserves safe reference text and excludes external symlinks',async()=>{
    const skill=join(temp,'sample-skill');mkdirSync(join(skill,'docs'),{recursive:true});
    mkdirSync(join(skill,'node_modules'),{recursive:true});
    writeFileSync(join(skill,'SKILL.md'),'---\nname: sample-skill\ndescription: isolated\n---\n# Test\n');
    writeFileSync(join(skill,'docs/reference.md'),'Visible UTF-8 中文\n');
    writeFileSync(join(skill,'node_modules/secret.js'),'should not package\n');
    const secret=join(temp,'secret.txt');writeFileSync(secret,'NEVER_PACKAGE_THIS_SECRET');
    symlinkSync(secret,join(skill,'private.txt'));
    const dest=join(temp,'rust.zip'),reference=join(temp,'node.zip');
    ok(await cli(['skill','package',skill,dest],env));
    ok(await run(process.execPath,[nodeReference,'skill','package',skill,reference],{env}));
    const contents=async path=>{
      const names=await run('/usr/bin/unzip',['-Z','-1',path],{env});ok(names);
      const found={};
      for(const name of names.stdout.trim().split('\n')){
        const data=await run('/usr/bin/unzip',['-p',path,name],{env});ok(data);
        found[name]=data.stdout;
      }
      return found;
    };
    const rustContents=await contents(dest),nodeContents=await contents(reference);
    const safeEntries=['sample-skill/SKILL.md','sample-skill/docs/reference.md'];
    assert.deepEqual(Object.keys(rustContents).sort(),safeEntries);
    for(const name of safeEntries)assert.equal(rustContents[name],nodeContents[name],
      `Safe ZIP text differs for ${name}`);
    assert.ok(!Object.hasOwn(rustContents,'sample-skill/private.txt'),
      'Rust must not package symlinks that escape the Skill root');
    if(Object.hasOwn(nodeContents,'sample-skill/private.txt'))observations.push(
      'Legacy Node Skill packager includes an external symlink target; Rust excludes it');
    assert.ok(!readFileSync(dest).includes(Buffer.from('NEVER_PACKAGE_THIS_SECRET')));
    isPrivate(dest,0o600);
    const initial=readFileSync(dest);
    failed(await cli(['skill','package',skill,dest],env));
    assert.deepEqual(readFileSync(dest),initial,'ZIP overwrite must be forbidden');
  });

  await verify('Eval dry-run uses installed Rust Relay PromptBuilder, private report, no Codex',async()=>{
    const result=await cli(['eval','run','--project','sample','--case','choose-plan','--dry-run'],env);ok(result);
    const output=obj(result);assert.equal(output.executed,0);assert.equal(output.mode,'dry-run');
    assert.ok(output.report.startsWith(realpathSync(join(project,'.evals/reports'))+'/'),
      'Eval report must stay beneath fixture Project');
    const report=JSON.parse(readFileSync(output.report,'utf8'));
    assert.equal(report.promptSource,'agents-relay/managedWorkerInput');
    assert.equal(report.results[0].builder,'managedWorkerInput');
    assert.equal(report.results[0].status,'DRY_RUN');
    const reportDir=dirname(output.report);
    isPrivate(reportDir,0o700);isPrivate(output.report,0o600);
    assert.ok(existsSync(join(reportDir,'choose-plan.production.prompt.txt')));
    assert.ok(!existsSync(join(home,'codex-called')));
  });

  await verify('Eval fixture Codex returns PASS report without model network',async()=>{
    const codex=join(fakeBin,'codex');
    writeFileSync(codex,`#!/bin/sh\nlast=\"\"\nwhile [ \"$#\" -gt 0 ]; do\n if [ \"$1\" = --output-last-message ]; then last=\"$2\";shift 2;else shift;fi\ndone\ncat >/dev/null\nprintf '%s' '{\"decision\":\"plan\",\"actions\":[\"inspect fixture\"],\"reason\":\"fixture\"}' > \"$last\"\n`);
    chmodSync(codex,0o755);
    const result=await cli(['eval','run','--project','sample','--case','choose-plan'],env);ok(result);
    const output=obj(result);assert.equal(output.executed,1);assert.equal(output.passed,1);assert.equal(output.failed,0);
    const report=JSON.parse(readFileSync(output.report,'utf8'));
    assert.equal(report.results[0].status,'PASS');
    assert.equal(report.results[0].actual,'plan');
    isPrivate(output.report,0o600);
  });

  await verify('Eval wrong decision produces truthful FAIL report and nonzero CLI exit',async()=>{
    const codex=join(fakeBin,'codex');
    writeFileSync(codex,`#!/bin/sh\nlast=\"\"\nwhile [ \"$#\" -gt 0 ]; do\n if [ \"$1\" = --output-last-message ]; then last=\"$2\";shift 2;else shift;fi\ndone\ncat >/dev/null\nprintf '%s' '{\"decision\":\"execute\",\"actions\":[],\"reason\":\"fixture\"}' > \"$last\"\n`);
    chmodSync(codex,0o755);
    const result=await cli(['eval','run','--project','sample','--case','choose-plan'],env);
    assert.equal(result.code,1);
    const output=obj(result);assert.equal(output.executed,1);assert.equal(output.passed,0);assert.equal(output.failed,1);
    const report=JSON.parse(readFileSync(output.report,'utf8'));
    assert.equal(report.results[0].status,'FAIL');
    assert.equal(report.results[0].actual,'execute');
    isPrivate(output.report,0o600);
  });

  await verify('Eval project-owned Node workload via Rust CLI',async()=>{
    const result=await cli(['eval','run','--project','sample','--case','js-workload'],env);ok(result);
    const info=obj(result);assert.equal(info.passed,1);assert.equal(info.executed,1);
    const report=JSON.parse(readFileSync(info.report,'utf8'));
    assert.equal(report.results[0].type,'node-tests');assert.equal(report.results[0].status,'PASS');
    const log=join(dirname(info.report),'js-workload.tests.log');assert.ok(existsSync(log));
    isPrivate(log,0o600);
  });

  await verify('Eval invalid case fails before creating report',async()=>{
    const reports=join(project,'.evals/reports'),old=readdirSync(reports).length;
    failed(await cli(['eval','run','--project','sample','--case','not-found'],env));
    assert.equal(readdirSync(reports).length,old);
  });

  // A loopback-only mock verifies Rust CLI -> Neo.app native MCP payloads,
  // but it never opens Preview or AskQuestions in the production application.
  const requests=[];
  server=createServer(async(req,res)=>{
    let data='';for await(const chunk of req)data+=chunk;
    let payload;try{payload=JSON.parse(data)}catch{res.writeHead(400).end();return}
    requests.push(payload);
    const tools=[{name:'askquestions'},{name:'review.preview'},{name:'markcut.preview'},{name:'secret.internal'}];
    const deny=payload.params?.arguments?.title==='Denied';
    const result=payload.method==='tools/list'?{tools}: {isError:deny,content:[{type:'text',text:deny?'fixture-denied':'fixture-approved'}]};
    const bytes=JSON.stringify({jsonrpc:'2.0',id:1,result});
    res.writeHead(200,{'content-type':'application/json','content-length':Buffer.byteLength(bytes)});res.end(bytes);
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
  const deployment=join(home,'Library/Application Support/NeoY/deployment.json');
  writeFileSync(deployment,JSON.stringify({mcpPort:server.address().port}));

  await verify('MCP askquestions actual Rust CLI, loopback mock only',async()=>{
    const file=join(temp,'ask.json');writeFileSync(file,JSON.stringify({title:'Fixture',questions:['What changed?']}));
    const response=await cli(['mcp','call','askquestions','--args-file',file],env);ok(response);
    assert.equal(obj(response).isError,false);
    const last=requests.at(-1);assert.equal(last.method,'tools/call');
    assert.equal(last.params.name,'askquestions');
    assert.deepEqual(last.params.arguments.questions,['What changed?']);
    assert.equal(requests.at(-2).method,'tools/list');
  });

  await verify('MCP tool denial is surfaced with exit code 2',async()=>{
    const file=join(temp,'ask-denied.json');
    writeFileSync(file,JSON.stringify({title:'Denied',questions:['Should fail?']}));
    const result=await cli(['mcp','call','askquestions','--args-file',file],env);
    assert.equal(result.code,2);
    assert.equal(obj(result).isError,true);
    assert.equal(requests.at(-1).params.name,'askquestions');
  });

  await verify('MCP Preview actual Rust CLI, loopback mock only',async()=>{
    const markdown=join(temp,'preview.md');writeFileSync(markdown,'# Fixture Preview\n');
    const file=join(temp,'preview-args.json');writeFileSync(file,JSON.stringify({path:markdown,title:'Synthetic'}));
    const r=await cli(['mcp','call','review.preview','--args-file',file],env);ok(r);
    assert.equal(requests.at(-1).params.name,'review.preview');
    assert.equal(requests.at(-1).params.arguments.path,markdown);
  });

  await verify('MCP unsafe command blocked before any RPC',async()=>{
    const count=requests.length;
    const r=await cli(['mcp','call','secret.internal','--args-file',join(temp,'ask.json')],env);failed(r);
    assert.equal(requests.length,count);
  });

  await verify('MCP token issue invalid origin rolls back private output without network',async()=>{
    const file=join(temp,'token-not-created');
    writeFileSync(env.NEO_MCP_OPERATOR_TOKEN_FILE,'fixture-operator-not-real');
    const count=requests.length;
    const r=await cli(['mcp','token','issue','--output',file,'--origin','http://127.0.0.1:1'],env);failed(r);
    assert.ok(!existsSync(file));assert.equal(requests.length,count);
  });

  await verify('Compute Web add/status/token/rotate/remove stays in fixture HOME',async()=>{
    const registry=env.NEO_GPU_REGISTRY_FILE;mkdirSync(dirname(registry),{recursive:true});
    writeFileSync(registry,JSON.stringify({version:1,services:{fixture:{mode:'web',published:true,image:'ghcr.io/test/fixture:v1',appPort:7860}}}));
    const add=await cli(['compute','web','add','fixture','--provider','hf','--budget','1'],env);ok(add);
    const first=obj(add).token;assert.ok(first.length>20);
    const tokenfile=join(env.NEO_GPU_WEB_DIR,'tokens/fixture.token');
    assert.equal(readFileSync(tokenfile,'utf8').trim(),first);isPrivate(tokenfile,0o600);
    const current=await cli(['compute','web','status','fixture'],env);ok(current);
    assert.equal(obj(current).session.phase,'stopped');
    const token=await cli(['compute','web','token','fixture'],env);ok(token);
    assert.equal(obj(token).token,first);
    const rotate=await cli(['compute','web','rotate','fixture'],env);ok(rotate);
    assert.notEqual(obj(rotate).token,first);
    const start=await cli(['compute','web','start','fixture'],env);failed(start);
    assert.ok(!existsSync(join(home,'provider-called')));
    const removed=await cli(['compute','web','remove','fixture'],env);ok(removed);
    assert.equal(obj(removed).phase,'removed');
    assert.ok(!existsSync(tokenfile));
    const after=await cli(['compute','web','status'],env);ok(after);
    assert.deepEqual(obj(after),{});
    assert.ok(!existsSync(join(home,'provider-called')));
  });

  await verify('Rust Neo CLI creates/resumes one Job through isolated real Rust Relay',async()=>{
    const script=join(root,'scripts/verify-rust-relay-isolated.mjs');
    const result=await run(process.execPath,['--no-warnings',script,relaySource],{env:process.env,timeout:120000});
    assert.equal(result.code,0,`Isolated Relay fixture failed: ${result.stderr.slice(-1200)}`);const summary=obj(result);
    assert.equal(summary.passed,true);assert.equal(summary.jobs,1);
    assert.equal(summary.jobIdStable,true);assert.equal(summary.taskIdStable,true);
    assert.equal(summary.foregroundAttached,true);assert.equal(summary.preflightRejected,true);
    assert.equal(summary.productionStateTouched,false);
  });

  await verify('No fake Compute provider executable invoked',async()=>{
    assert.ok(!existsSync(join(home,'provider-called')));
  });
}finally{
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  rmSync(temp,{recursive:true,force:true});
}
const failures=cases.filter(t=>t.status==='FAIL');
const report={schemaVersion:1,scope:'controlled-write-disposable-blackbox',passed:cases.length-failures.length,total:cases.length,
  cases,observations,remaining:[
    'Real OAuth HTTPS issuance/revocation (not attempted; protected operator account)',
    'Production UI interaction (not attempted)',
    'Paid HF/Vast and GitHub push/build (not authorized)',
    'Installed Neo CLI replacement/rollback (not authorized)'
  ]};
console.log(JSON.stringify(report,null,2));
if(failures.length)process.exitCode=1;
