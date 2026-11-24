#!/usr/bin/env node
/**
 * Real Neo Harness Rust -> Rust Relay E2E in a disposable Git/SQLite/daemon.
 * Requires Node 22.5+ only as a TEST DRIVER (not as a Harness runtime).
 * Usage: node scripts/verify-rust-relay-isolated.mjs /absolute/agents-relay/repo
 * Nothing in the user's production Relay SQLite, Jobs or Projects is modified.
 */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, chmodSync, closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const harnessRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = process.argv[2];
const terminal = process.argv.includes("--terminal");
const reliability = process.argv.includes("--reliability");
assert(!(terminal && reliability), "Select one test mode");
if (!sourceRoot || !isAbsolute(sourceRoot)) {
  process.stderr.write('Usage: node scripts/verify-rust-relay-isolated.mjs /absolute/agents-relay/repo\n');
  process.exit(2);
}
const original = join(homedir(), '.local/share/agents-relay/live/bin');
for (const file of [
  join(original, 'agents-relay-rust'),
  join(original, 'agents-relayd-rust'),
  join(sourceRoot, 'rust/target/debug/owned-process-supervisor'),
  join(sourceRoot, 'rust/src/unified_relay_schema.rs'),
  join(sourceRoot, 'workflow')
]) assert(existsSync(file), `required Relay test dependency missing: ${file}`);

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function freePort() {
  const socket = createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  socket.close();
  await once(socket, 'close');
  return port;
}

async function main() {
  const base = mkdtempSync(join(tmpdir(), 'neo-harness-real-relay-'));
  let daemon;
  let history;
  let logFd;
  try {
    const workspace = join(base, 'workspace');
    const projectName = terminal ? 'vlog' : 'sample';
    const project = join(workspace, projectName);
    const run = join(project, 'runs', '2026-11-23-episode');
    const stores = join(base, 'stores');
    const home = join(base, 'home');
    const binaries = join(base, 'isolated-binaries');
    mkdirSync(run, { recursive: true });
    for (const dir of [stores, home, binaries]) mkdirSync(dir);
    copyFileSync(join(original, 'agents-relay-rust'), join(binaries, 'agents-relay-rust'));
    copyFileSync(join(original, 'agents-relayd-rust'), join(binaries, 'agents-relayd-rust'));
    copyFileSync(join(sourceRoot, 'rust/target/debug/owned-process-supervisor'), join(binaries, 'owned-process-supervisor'));
    for (const name of ['agents-relay-rust', 'agents-relayd-rust', 'owned-process-supervisor']) chmodSync(join(binaries, name), 0o755);
    cpSync(join(sourceRoot, 'workflow'), join(base, 'workflow'), { recursive: true });

    writeFileSync(join(project, 'AGENTS.md'), '# Isolated Neo Test\n');
    writeFileSync(join(project, 'README.md'), '# Test Project\n');
    writeFileSync(join(project, 'graph.mmd'), terminal ? 'flowchart TD\n  A[agent:fixture]\n' : 'flowchart TD\n  A[agent:writer] --> B[agent:editor]\n');
    if (terminal) {
      writeFileSync(join(run,'source-manifest.json'), JSON.stringify({source_use:{approved:true,scope:'private synthetic fixture only'}}));
      mkdirSync(join(project, 'agents/.shortcut'), {recursive:true});
      writeFileSync(join(project,'agents/fixture.agent.md'), '---\nname: fixture\ncapabilities: [script]\n---\n# Isolated real Script Worker\n');
      writeFileSync(join(project,'agents/.shortcut/fixture.agent.mjs'), "export async function run({input}) {return {status:'COMPLETED',output:{blackbox:true,execution:input.executionId},artifacts:{}};}\n");
    }
    writeFileSync(join(project, 'project.run.json'), JSON.stringify({
      schemaVersion: 1,
      input: { type: 'path', path: { base: 'runs', datedRunDirectory: true } },
      versioning: { mode: 'local-git', template: 'run-template' }
    }));
    mkdirSync(join(project, 'run-template'));
    writeFileSync(join(project, 'run-template/.gitignore'), '.neo-project-run.json\nsource-reference.json\nneo-project-run.*\n');
    execFileSync('git', ['init', '-q', project]);
    const config = join(base, 'workspace.json');
    writeFileSync(config, JSON.stringify({ schemaVersion: 1, neoRoot: workspace }));

    // Official *schema only*; no production SQLite contents or WAL copied.
    const schemaText = readFileSync(join(sourceRoot, 'rust/src/unified_relay_schema.rs'), 'utf8');
    const schema = /r####"([\s\S]*?)"####;/.exec(schemaText)?.[1];
    assert(schema, 'Cannot resolve canonical Rust Relay schema');
    const dbPath = join(base, 'relay.sqlite');
    const init = new DatabaseSync(dbPath);
    init.exec(schema);
    init.close();

    const port = await freePort();
    // Current Rust Relay isolated-write foreground requires an explicitly
    // caller-owned loopback EventBus history reader. It is read-only and
    // returns no synthetic progress: SQLite/Graph remain the sole authority.
    history=createHttpServer((request,response)=>{
      const url=new URL(request.url,'http://127.0.0.1/');
      if(request.method!=='GET'||url.pathname!=='/events'){
        response.writeHead(404).end();return;
      }
      const job=url.searchParams.get('job')||'';
      const payload=JSON.stringify({job_id:job,order:'desc',events:[],next_cursor:0});
      response.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store',
        'Content-Length':Buffer.byteLength(payload),'Connection':'close'});
      response.end(payload);
    });
    await new Promise((resolve,reject)=>{
      history.once('error',reject);
      history.listen(0,'127.0.0.1',resolve);
    });
    const historyUrl=`http://127.0.0.1:${history.address().port}/`;
    // Capture the authoritative stderr of each fixture-only Relay invocation.
    // The Rust Harness intentionally suppresses raw production subprocess output.
    const relayErrors=join(base,'relay-errors');mkdirSync(relayErrors);
    const relayWrapper=join(binaries,'fixture-relay');
    writeFileSync(relayWrapper,`#!/bin/sh\nexec "${join(binaries,'agents-relay-rust')}" "$@" 2>"${relayErrors}/$$.log"\n`,{mode:0o700});
    const environment = {
      ...process.env,
      HOME: home,
      AGENTS_RELAY_STORE_DIR: join(home, '.agents-relay/stores'),
      AGENTS_RELAY_WORKSPACE_ROOT: workspace,
      NEO_ROOT: workspace,
      NEO_WORKSPACE_CONFIG: config,
      NEO_RELAY_EXECUTABLE: relayWrapper,
      NEO_RELAY_CONTROL_PORT: String(port),
      AGENTS_RELAY_SCRIPT_NODE: process.execPath
    };
    logFd = openSync(join(base, 'daemon.log'), 'w');
    daemon = spawn(join(binaries, 'agents-relayd-rust'), [
      '--isolated-write-store-dir', stores,
      '--event-history-api', historyUrl,
      '--port', String(port), '--interval', '600000',
      '--repo', projectName, '--workspace-root', workspace
    ], { cwd: base, env: environment, stdio: ['ignore', logFd, logFd] });
    let healthy = false;
    for (let i = 0; i < 45; i++) {
      if (daemon.exitCode !== null) break;
      try {
        const probe = await fetch(`http://127.0.0.1:${port}/api/status`, {
          signal: AbortSignal.timeout(500)
        });
        if (probe.ok) { healthy = true; break; }
      } catch { /* daemon is still starting */ }
      await delay(100);
    }
    assert(healthy, `Isolated Relay daemon unavailable: ${readFileSync(join(base, 'daemon.log'), 'utf8')}`);

    if (!reliability) execFileSync('cargo', ['build', '--offline', '-q', '--workspace'], { cwd: harnessRoot, timeout: 90_000 });
    const rust = join(harnessRoot, reliability ? 'target/release/neo-rs' : 'target/debug/neo-rs');
    assert(existsSync(rust), 'Build Release native CLI first');
    // Declared DAG execution validates the project and supplies Relay internal preflight.
    const input = ['project', 'run', '--project', projectName, '--path', run, ...(terminal ? ['--no-review'] : [])];
    // Obsolete caller preflight flags are rejected before any Relay request.
    for (const options of [
      ['project', 'run', '--project', projectName, '--path', run, '--preflight=true'],
      ['project', 'run', '--project', projectName, '--path', run, '--preflight=false']
    ]) {
      const rejected = spawnSync(rust, options, {
        cwd: workspace, env: environment, encoding: 'utf8', timeout: 10_000
      });
      assert.notEqual(rejected.status, 0, 'obsolete caller preflight was accepted');
      assert.match(rejected.stderr, /unknown project run option/);
    }
    assert(!existsSync(join(run, '.neo-project-run.json')),
      'rejected caller option must not create a Run binding');
    const preflightRejected = true;
    const execute = () => JSON.parse(execFileSync(rust, input, {
      cwd: workspace, env: environment, encoding: 'utf8', timeout: 20_000
    }));
    // Six independent CLI processes racing for exactly the same canonical Run.
    // The real daemon and SQLite decide the durable identity, not a mock.
    let concurrent = [];
    if (reliability) {
      concurrent = await Promise.all(Array.from({length:6},()=>new Promise((resolve,reject)=>{
        const child=spawn(rust,input,{cwd:workspace,env:environment,stdio:['ignore','pipe','pipe']});
        let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);
        const timeout=setTimeout(()=>child.kill('SIGKILL'),30000);
        child.once('error',e=>{clearTimeout(timeout);reject(e)});
        child.once('close',code=>{clearTimeout(timeout);try{assert.equal(code,0,err.slice(-1000));resolve(JSON.parse(out))}catch(e){reject(e)}});
      })));
      for(const row of concurrent)assert.deepEqual(row,concurrent[0]);
    }
    const created = reliability ? concurrent[0] : execute();
    assert.equal(created.status, 'ACTIVE');
    assert.match(String(created.jobId), /^[1-9][0-9]*$/);
    assert.match(String(created.taskId), /^[1-9][0-9]*$/);
    assert(existsSync(join(run, '.neo-project-run.json')), 'private binding not written');
    assert.equal((readFileSync(join(run, '.neo-project-run.json')).length > 10), true);
    const before = execFileSync('git', ['-C', run, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const resumed = execute();
    assert.deepEqual(resumed, created, 'Run resume changed authoritative Job/Task');
    const after = execFileSync('git', ['-C', run, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    assert.equal(after, before, 'Run Git HEAD changed during idempotent resume');
    if (terminal) {
      // No external model/reviewer and no state injection. The owned Script
      // Worker must really run and the ordinary Relay Graph must close it.
      const worker = spawn(rust, [...input, '--foreground'], {
        cwd:workspace,env:environment,detached:true,stdio:['ignore','pipe','pipe']
      });
      let output='',errors='';
      worker.stdout.on('data',b=>output+=b.toString());
      worker.stderr.on('data',b=>errors+=b.toString());
      const completion=once(worker,'exit');
      let exit;
      try {
        exit=await Promise.race([completion,delay(35000).then(()=>null)]);
        assert(exit, 'Script DAG terminal deadline exceeded: '+output.slice(-1600)+' '+errors.slice(-1000));
        assert.equal(exit[0],0,'foreground exit failed: '+errors.slice(-1200));
      } finally {
        if(worker.exitCode===null&&worker.signalCode===null){
          try {process.kill(-worker.pid,'SIGKILL')}catch{}
          await Promise.race([completion,delay(1000)]);
        }
      }
      const snapshot=new DatabaseSync(dbPath,{readOnly:true});
      const rows=snapshot.prepare('SELECT json FROM job_snapshot').all();
      assert.equal(rows.length,1);
      const job=JSON.parse(rows[0].json);
      assert.equal(job.state,'COMPLETED');
      const child=job.tasks.find(t=>t.agentName==='fixture');
      assert(child,'missing real Script DAG child');
      assert.equal(child.state,'SUCCEEDED');assert.equal(child.attempt,1);
      assert.equal(child.result.data.output.blackbox,true);
      const events=snapshot.prepare('SELECT COUNT(*) AS n FROM workflow_event_outbox WHERE event_key LIKE ?').get('script-event/'+created.jobId+'/'+child.id+'/%').n;
      snapshot.close();
      assert.equal(events,2,'expected actual Script start/completion events');
      const final=JSON.parse(execFileSync(rust,['project','run','--project',projectName,'--path',run,'--no-review'],{cwd:workspace,env:environment,encoding:'utf8',timeout:15000}));
      assert.equal(final.status,'COMPLETED');assert.equal(final.reused,true);
      assert.equal(final.jobId,created.jobId);assert.equal(final.taskId,created.taskId);
      const receipt=JSON.parse(readFileSync(join(run,'neo-project-run.result.json'),'utf8'));
      assert.equal(receipt.status,'COMPLETED');
      assert.equal(receipt.output.nodes.A.output.blackbox,true);
      console.log(JSON.stringify({passed:true,mode:'isolated-real-script-terminal',jobState:job.state,workerState:child.state,workerAttempts:child.attempt,events,jobIdStable:true,taskIdStable:true,preflightRejected,reviewEnabled:false,productionStateTouched:false},null,2));
      return;
    }
    if (reliability) {
      const boundPath=join(run,'.neo-project-run.json');
      const binding=readFileSync(boundPath);
      const interruptResults=[];
      for(const signal of ['SIGINT','SIGTERM']) {
        const foreground=spawn(rust,[...input,'--foreground'],{cwd:workspace,env:environment,detached:true,stdio:['ignore','pipe','pipe']});
        let output='',errors='';foreground.stdout.on('data',b=>output+=b);foreground.stderr.on('data',b=>errors+=b);
        const done=once(foreground,'exit');
        try {
          for(let i=0;i<100&&!output.includes('foreground daemon attachment');i++){
            assert.equal(foreground.exitCode,null,'Foreground unexpectedly exited: '+errors.slice(-800));
            await delay(50);
          }
          assert(output.includes('foreground daemon attachment'),'No real Relay foreground attachment');
          const attached=JSON.parse(output.split('\n')[0]);assert.equal(attached.jobId,created.jobId);assert.equal(attached.taskId,created.taskId);
          process.kill(-foreground.pid,signal);
          const ended=await Promise.race([done,delay(8000).then(()=>null)]);assert(ended,'Foreground process did not exit');
          assert(ended[1]===signal||ended[0]===130||ended[0]===143||ended[0]===1,'Unexpected signal exit');
          for(let i=0;i<80;i++){try{process.kill(-foreground.pid,0)}catch(e){if(e.code==='ESRCH')break;throw e}await delay(50)}
          assert.throws(()=>process.kill(-foreground.pid,0),{code:'ESRCH'},'Foreground process group left alive');
          assert(binding.equals(readFileSync(boundPath)),'Binding changed after interrupt');
          const retry=execute();assert.deepEqual(retry,created);
          interruptResults.push({signal,exit:ended[0],signalExit:ended[1],resumed:true});
        }finally{try{process.kill(-foreground.pid,'SIGKILL')}catch{}}
      }
      const verify=new DatabaseSync(dbPath,{readOnly:true});
      const rows=verify.prepare('SELECT json FROM job_snapshot').all();verify.close();
      assert.equal(rows.length,1);const job=JSON.parse(rows[0].json);assert.equal(job.state,'ACTIVE');
      assert.equal(execFileSync('git',['-C',run,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),before);
      console.log(JSON.stringify({passed:true,mode:'isolated-real-relay-reliability',parallelCliProcesses:concurrent.length,jobs:rows.length,jobState:job.state,interruptResults,bindingStable:true,gitStable:true,productionStateTouched:false},null,2));
      return;
    }
    // Attach to the same ACTIVE Coordinator via the real Rust Relay CLI.
    // Terminate only this separate terminal process group; the daemon/Job
    // remain alive and resume must continue to resolve the exact same Job.
    const foreground = spawn(rust, [...input, '--foreground'], {
      cwd: workspace, env: environment, detached: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let streamed = '';
    let streamedError = '';
    const done = once(foreground, 'exit');
    const firstIdentity = new Promise(resolve => {
      foreground.stdout.on('data', bytes => {
        streamed += bytes.toString('utf8');
        if (streamed.includes('\n')) resolve();
      });
      foreground.stderr.on('data', bytes => { streamedError += bytes.toString('utf8'); });
    });
    try {
      await Promise.race([firstIdentity, delay(3500)]);
      assert(streamed.includes('\n'), `Foreground failed to publish attached Job identity: ${streamedError}`);
      const attached = JSON.parse(streamed.split('\n')[0]);
      assert.equal(attached.foreground, true);
      assert.equal(attached.status, 'ACTIVE');
      assert.equal(attached.jobId, created.jobId);
      assert.equal(attached.taskId, created.taskId);
      await delay(350);
      assert.equal(foreground.exitCode, null, `Foreground ended unexpectedly: ${streamedError}`);
    } finally {
      try { process.kill(-foreground.pid, 'SIGTERM'); } catch { /* already exited */ }
      await Promise.race([done, delay(1400)]);
      if (foreground.exitCode === null && foreground.signalCode === null) {
        try { process.kill(-foreground.pid, 'SIGKILL'); } catch { /* already exited */ }
        await Promise.race([done, delay(1000)]);
      }
    }
    const foregroundAttached = true;
    const verify = new DatabaseSync(dbPath, { readOnly: true });
    const count = verify.prepare('SELECT COUNT(*) AS n FROM job_snapshot').get().n;
    verify.close();
    assert.equal(count, 1, 'isolation run duplicated Coordinator Job');
    console.log(JSON.stringify({
      passed: true,
      mode: 'isolated-real-rust-relay',
      created: created.status,
      resumed: resumed.status,
      jobIdStable: created.jobId === resumed.jobId,
      taskIdStable: created.taskId === resumed.taskId,
      jobs: count,
      privateRunGitStable: before === after,
      foregroundAttached,
      preflightRejected,
      productionStateTouched: false
    }, null, 2));
  } catch (error) {
    const daemonLog = existsSync(join(base, 'daemon.log')) ? readFileSync(join(base, 'daemon.log'), 'utf8') : '';
    // The fixture contains only synthetic Project data. Surface the
    // authoritative CLI stderr to diagnose contract changes, not private
    // production state (which this script never mounts or reads).
    const cliError=error?.stderr ? String(error.stderr).slice(-1400) : '';
    const relayErrors=join(base,'relay-errors');
    const details=existsSync(relayErrors)?readdirSync(relayErrors).map(f=>readFileSync(join(relayErrors,f),'utf8')).filter(Boolean).join('\n').slice(-2200):'';
    if(details)process.stderr.write('Isolated Relay subprocess errors:\n'+details+'\n');
    process.stderr.write(`Isolated real Relay verification failed: ${error.message}\n${cliError}\n${daemonLog.slice(-1600)}\n`);
    process.exitCode = 1;
  } finally {
    if (daemon?.exitCode === null) {
      daemon.kill('SIGTERM');
      await Promise.race([once(daemon, 'exit'), delay(1500)]);
      if (daemon.exitCode === null) {
        daemon.kill('SIGKILL');
        await Promise.race([once(daemon, 'exit'), delay(1500)]);
      }
    }
    if(history){
      history.closeAllConnections();
      await new Promise(resolve=>history.close(resolve));
    }
    if (logFd !== undefined) closeSync(logFd);
    rmSync(base, { recursive: true, force: true });
  }
}
await main();
