import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runProject } from '../.bin/neo-project-run.mjs';

const root = resolve(import.meta.dirname, '..');
function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'neo-project-run-'));
  const workspaceRoot = join(base, 'workspace');
  const neoRoot = join(workspaceRoot, 'neo');
  const content = join(neoRoot, 'content-distribution');
  const vlog = join(neoRoot, 'vlog');
  mkdirSync(content, { recursive: true }); mkdirSync(vlog, { recursive: true });
  for (const [dir, declaration] of [[content, { schemaVersion: 1, input: { type: 'url', schemes: ['https'], resumePath: true } }], [vlog, { schemaVersion: 1, publicationReview: 'publisher-explicit-authorization', input: { type: 'path', path: { base: 'runs', datedRunDirectory: true } } }]]) {
    writeFileSync(join(dir, 'AGENTS.md'), 'project policy');
    writeFileSync(join(dir, 'README.md'), 'project readme');
    writeFileSync(join(dir, 'graph.mmd'), 'flowchart TD\n  a --> b\n');
    writeFileSync(join(dir, 'project.run.json'), JSON.stringify(declaration));
    execFileSync('git', ['init', '-q', dir]);
  }
  mkdirSync(join(vlog, 'runs', '2026-11-03-episode'), { recursive: true });
  return { base, workspace: { neoRoot, harnessRoot: root }, content, vlog, runDir: join(vlog, 'runs', '2026-11-03-episode') };
}
function relayStub() {
  const calls = [], jobs = new Map(), tasks = new Map(); let next = 0; const failures = new Set();
  return {
    calls, jobs, tasks, failures,
    runRelayJob(args) {
      calls.push([...args]);
      if (failures.has('job:run')) return 1;
      const jobId = args[args.indexOf('--id') + 1];
      const selected = jobs.get(jobId);
      if (selected) selected.state = 'COMPLETED';
      const rows = tasks.get(jobId) ?? [];
      for (const item of rows) item.state = 'SUCCEEDED';
      return 0;
    },
    runRelay(args) {
      calls.push([...args]);
      const key = `${args[0]}:${args[1]}`;
      if (failures.has(key)) throw new Error(`stub ${key} failure`);
      if (args[0] === 'job' && args[1] === 'create') {
        const id = `job-${++next}`;
        const repository = args[args.indexOf('--repo') + 1];
        jobs.set(id, { id, repository, projectPath: args[args.indexOf('--project-path') + 1], contentOnly: true, executionMode: 'shortcut' });
        return { repository, pr: 0, job: id, state: 'DRAFT' }; // Actual Relay job.create response
      }
      if (args[0] === 'job' && args[1] === 'show') return jobs.get(args[args.indexOf('--id') + 1]) ?? {};
      if (args[0] === 'task' && args[1] === 'list') return { tasks: tasks.get(args[args.indexOf('--id') + 1]) ?? [] };
      if (args[0] === 'task' && args[1] === 'create') {
        const jobId = args[args.indexOf('--id') + 1], taskId = args[args.indexOf('--task-id') + 1];
        const row = { id: taskId, input: readFileSync(args[args.indexOf('--input-file') + 1], 'utf8'),
          output: { kind: 'file', path: args[args.indexOf('--output-path') + 1] },
          agentGraph: readFileSync(args[args.indexOf('--agent-graph-file') + 1], 'utf8') };
        const rows = tasks.get(jobId) ?? [];
        if (!rows.some(task => task.id === taskId)) rows.push(row);
        tasks.set(jobId, rows);
        return row;
      }
      throw new Error(`unexpected Relay argv: ${args.join(' ')}`);
    }
  };
}
async function run(args, f, relay, extra = {}) {
  const output = [];
  await runProject(args, { workspace: f.workspace, runRelay: relay.runRelay, runRelayJob: relay.runRelayJob, emit: value => output.push(value), now: new Date('2026-11-03T12:00:00Z'), ...extra });
  return output[0] ?? '';
}

test('URL input supports both flag forms, keeps token private, and delegates exact graph', async () => {
  const f = fixture(), relay = relayStub();
  try {
    const out = await run(['--url=https://rsroot.com/xxxid?token=secret-token', '--project', 'content-distribution'], f, relay);
    const result = JSON.parse(out);
    assert.equal(result.project, 'content-distribution'); assert.equal(result.jobId, 'job-1'); assert.equal(result.taskId, 'content-run');
    assert.equal(out.includes('secret-token'), false);
    assert.equal(out.includes('rsroot.com'), false);
    assert.equal(result.runPath.includes('rsroot.com'), false);
    assert.deepEqual(relay.calls.map(x => x.slice(0, 2)), [['job', 'create'], ['task', 'create'], ['job', 'run'], ['job', 'show'], ['task', 'list']]);
    const job = relay.calls[0], task = relay.calls[1];
    assert.deepEqual(job.slice(2), ['--repo', 'local/content-distribution', '--project-path', '.', '--objective-file', join(result.runPath, 'neo-project-run.objective.md'), '--shortcut-execution', '--no-github']);
    assert.equal(task[task.indexOf('--agent-graph-file') + 1], realpathSync(join(f.content, 'graph.mmd')));
    assert.equal(task[task.indexOf('--output-path') + 1], join(result.runPath, 'neo-project-run.result.json'));
    assert.equal(relay.calls.flat().some(value => value.includes('secret-token') || value.includes('rsroot.com')), false);
    assert.equal(readFileSync(join(result.runPath, 'source-reference.json'), 'utf8').includes('secret-token'), true);
    assert.equal(readFileSync(join(result.runPath, 'neo-project-run.objective.md'), 'utf8').includes('secret-token'), false);
    assert.equal(statSync(join(result.runPath, 'source-reference.json')).mode & 0o777, 0o600);
    assert.equal(statSync(result.runPath).mode & 0o777, 0o700);
  } finally { rmSync(f.base, { recursive: true, force: true }); }
});

test('opted-in URL project processes a prepared canonical private Run without inventing URL rights', async () => {
  const f = fixture(), relay = relayStub();
  try {
    const declaration = JSON.parse(readFileSync(join(f.content,'project.run.json'),'utf8'));
    declaration.input.preparedPath=true;
    writeFileSync(join(f.content,'project.run.json'),JSON.stringify(declaration));
    const runPath=join(f.content,'runs','2026-11-07-prepared');
    mkdirSync(join(runPath,'evidence'),{recursive:true});
    writeFileSync(join(runPath,'campaign.json'),'{}');
    writeFileSync(join(runPath,'evidence','original-source.json'),'{}');
    const info=JSON.parse(await run(['--project=content-distribution','--path',runPath],f,relay));
    assert.equal(info.runPath,realpathSync(runPath));
    assert.equal(info.jobId,'job-1');
    const input=JSON.parse(readFileSync(join(runPath,'source-reference.json'),'utf8'));
    assert.equal(input.kind,'canonical-run');
    assert.equal(input.sourceUrl,undefined);
    assert.equal(relay.calls.filter(x=>x[0]==='job'&&x[1]==='create').length,1);
  } finally { rmSync(f.base,{recursive:true,force:true}); }
});

test('path input creates one run binding and a repeated invocation verifies instead of duplicating', async () => {
  const f = fixture(), relay = relayStub();
  try {
    const args = ['--project=vlog', '--path', f.runDir];
    const first = JSON.parse(await run(args, f, relay));
    const second = JSON.parse(await run(['--path=' + f.runDir, '--project=vlog'], f, relay));
    assert.equal(first.jobId, second.jobId); assert.equal(first.taskId, second.taskId); assert.equal(second.runPath, first.runPath);
    assert.equal(relay.calls.filter(x => x[0] === 'job' && x[1] === 'create').length, 1);
    assert.equal(relay.calls.filter(x => x[0] === 'task' && x[1] === 'create').length, 1);
    assert.deepEqual(relay.calls.slice(5).map(x => x.slice(0, 2)), [['job', 'show'], ['task', 'list']]);
  } finally { rmSync(f.base, { recursive: true, force: true }); }
});

test('a saved Job binding resumes missing Task creation after a Relay failure', async () => {
  const f = fixture(), relay = relayStub();
  try {
    relay.failures.add('task:create');
    await assert.rejects(() => run(['--path', f.runDir, '--project', 'vlog'], f, relay), /stub task:create failure/);
    const binding = JSON.parse(readFileSync(join(f.runDir, '.neo-project-run.json'), 'utf8'));
    assert.equal(binding.jobId, 'job-1'); assert.equal(binding.taskId, 'content-run');
    relay.failures.delete('task:create');
    const out = JSON.parse(await run(['--path', f.runDir, '--project', 'vlog'], f, relay));
    assert.equal(out.jobId, 'job-1'); assert.equal(relay.calls.filter(x => x[0] === 'job' && x[1] === 'create').length, 1);
    assert.equal(relay.calls.filter(x => x[0] === 'task' && x[1] === 'create').length, 2);
    assert.equal(relay.tasks.get('job-1').length, 1);
    assert.equal(relay.tasks.get('job-1')[0].id, 'content-run');
  } finally { rmSync(f.base, { recursive: true, force: true }); }
});

test('rejects a tampered private binding that points Relay input outside the selected run', async () => {
  const f = fixture(), relay = relayStub();
  try {
    const binding = join(f.runDir, '.neo-project-run.json');
    writeFileSync(binding, JSON.stringify({ schemaVersion: 1, project: 'vlog', runPath: f.runDir, jobId: 'job-1', taskId: 'content-run', taskInput: '/tmp/private.md' }));
    chmodSync(binding, 0o600);
    await assert.rejects(() => run(['--project', 'vlog', '--path', f.runDir], f, relay), /binding does not match/);
    assert.equal(relay.calls.length, 0);
  } finally { rmSync(f.base, { recursive: true, force: true }); }
});

test('URL project resumes a bound private run by path without another Job', async () => {
  const f = fixture(), relay = relayStub();
  try {
    relay.failures.add('task:create');
    await assert.rejects(() => run(['--url', 'https://rsroot.com/episode?token=secret', '--project', 'content-distribution'], f, relay), /stub task:create failure/);
    const runDir = join(f.content, 'runs', readdirSync(join(f.content, 'runs'))[0]);
    const saved = JSON.parse(readFileSync(join(runDir, '.neo-project-run.json'), 'utf8'));
    assert.equal(saved.jobId, 'job-1');
    relay.failures.delete('task:create');
    const resumed = JSON.parse(await run(['--path=' + runDir, '--project=content-distribution'], f, relay));
    assert.equal(resumed.jobId, 'job-1');
    assert.equal(JSON.parse(await run(['--path', runDir, '--project', 'content-distribution'], f, relay)).verified, true);
    assert.equal(relay.calls.filter(args => args[0] === 'job' && args[1] === 'create').length, 1);
    assert.equal(relay.tasks.get('job-1').length, 1);
    const empty = join(f.content, 'runs', '2026-11-03-empty'); mkdirSync(empty);
    await assert.rejects(() => run(['--path', empty, '--project', 'content-distribution'], f, relay), /only an existing bound Run/);
  } finally { rmSync(f.base, { recursive: true, force: true }); }
});

test('existing Relay Job and Task must match Run binding before reuse', async () => {
  const f = fixture(), relay = relayStub(), args = ['--project=vlog', '--path', f.runDir];
  try {
    await run(args, f, relay);
    const job = relay.jobs.get('job-1');
    job.projectPath = 'another-project';
    await assert.rejects(() => run(args, f, relay), /does not match this content-only project/);
    job.projectPath = '.';
    const task = relay.tasks.get('job-1')[0];
    for (const [property, value] of [['input', 'unrelated input'], ['agentGraph', 'flowchart TD\nC[agent:wrong]'], ['output', {kind:'file', path:'/tmp/unrelated'}]]) {
      const original = task[property]; task[property] = value;
      await assert.rejects(() => run(args, f, relay), /does not match this canonical Run/);
      task[property] = original;
    }
    const binding = join(f.runDir, '.neo-project-run.json');
    const original = JSON.parse(readFileSync(binding, 'utf8'));
    writeFileSync(binding, JSON.stringify({...original, repository:'other/repo'})); chmodSync(binding, 0o600);
    await assert.rejects(() => run(args, f, relay), /different Relay repository/);
  } finally { rmSync(f.base, { recursive: true, force: true }); }
});

test('dry-run validates without writes or Relay calls', async () => {
  const f = fixture(), relay = relayStub();
  try {
    const out = JSON.parse(await run(['--dry-run', '--project', 'content-distribution', '--url', 'https://rsroot.com/a?secret=abc'], f, relay));
    assert.equal(out.dryRun, true); assert.equal('sourceHost' in out, false);
    assert.equal(out.runPath.includes('rsroot.com'), false); assert.equal(out.runPath.includes('secret'), false);
    assert.equal(relay.calls.length, 0); assert.equal(statSync(join(f.content, 'runs'), { throwIfNoEntry: false }), undefined);
  } finally { rmSync(f.base, { recursive: true, force: true }); }
});

test('rejects bad argument combinations, URL forms, unconfigured project, missing graph, and path escapes', async () => {
  const f = fixture(), relay = relayStub();
  try {
    writeFileSync(join(f.workspace.neoRoot, '.git'), 'gitdir: ../.git/worktrees/source');
    await assert.rejects(() => run(['--project', 'vlog', '--path', f.runDir], f, relay), /linked Git worktree/);
    rmSync(join(f.workspace.neoRoot, '.git'));
    for (const args of [[], ['--project', 'vlog'], ['--project', 'vlog', '--path', f.runDir, '--url', 'https://x.test'], ['--project', '../vlog', '--url', 'https://x.test']])
      await assert.rejects(() => run(args, f, relay));
    for (const url of ['http://example.test/a', 'https://user:pass@example.test/a', 'not a url', 'https://example.test/\n', 'https://example.test/%zz'])
      await assert.rejects(() => run(['--project', 'content-distribution', '--url', url], f, relay));
    await assert.rejects(() => run(['--project', 'content-distribution', '--path', f.runDir], f, relay), /run path does not exist|inside this project runs/);
    await assert.rejects(() => run(['--project', 'vlog', '--path', f.runDir + '/../2026-11-03-episode'], f, relay), /traversal/);
    const media = join(f.vlog, 'runs', '2026-11-03-media.mp4'); writeFileSync(media, 'media');
    await assert.rejects(() => run(['--project', 'vlog', '--path', media], f, relay), /run directory/);
    const external = join(f.base, 'outside'); mkdirSync(external); mkdirSync(join(external, '2026-11-03-outside'));
    symlinkSync(external, join(f.vlog, 'runs', 'outside-link'));
    await assert.rejects(() => run(['--project', 'vlog', '--path', join(f.vlog, 'runs', 'outside-link', '2026-11-03-outside')], f, relay), /inside this project runs/);
    writeFileSync(join(f.content, 'graph.mmd'), '');
    const unsupported = join(f.workspace.neoRoot, 'no-config'); mkdirSync(unsupported);
    for (const file of ['AGENTS.md', 'README.md', 'graph.mmd']) writeFileSync(join(unsupported, file), 'x');
    await assert.rejects(() => run(['--project', 'no-config', '--url', 'https://example.test'], f, relay), /missing required project.run.json/);
    rmSync(join(f.vlog, 'graph.mmd'));
    await assert.rejects(() => run(['--project', 'vlog', '--path', f.runDir], f, relay), /missing required graph.mmd/);
    assert.equal(relay.calls.length, 0);
  } finally { rmSync(f.base, { recursive: true, force: true }); }
});

test('CLI help and independent-only project resolution remain available', async () => {
  const help = execFileSync(process.execPath, [join(root, '.bin/neo.mjs'), 'project', 'run', '--help'], { encoding: 'utf8' });
  assert.match(help, /--dry-run/);
  const resolved = JSON.parse(execFileSync(process.execPath, [join(root, '.bin/neo.mjs'), 'project', 'resolve', 'vlog'], { encoding: 'utf8' }));
  assert.equal(resolved.name, 'vlog');
  assert.equal(resolved.neo_project, true);
  const legacy = spawnSync(process.execPath, [join(root, '.bin/neo.mjs'), 'project', 'resolve', 'neo/vlog'], { encoding: 'utf8' });
  assert.notEqual(legacy.status, 0);
});

test('installed CLI resolves configured Neo root independently of cwd and rejects invalid workspace config', async () => {
  const f = fixture(), relay = relayStub();
  try {
    const config = join(f.base, 'workspace.json');
    writeFileSync(config, JSON.stringify({ schemaVersion: 1, neoRoot: f.workspace.neoRoot }));
    const cli = join(root, '.bin/neo.mjs');
    const result = spawnSync(process.execPath, [cli, 'project', 'run', '--dry-run', '--url', 'https://source.example/item', '--project=content-distribution'], {
      cwd: f.base, encoding: 'utf8', env: { ...process.env, NEO_WORKSPACE_CONFIG: config }
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).project, 'content-distribution');
    assert.equal(result.stdout.includes(f.base), true);
    writeFileSync(config, JSON.stringify({ schemaVersion: 2, neoRoot: f.workspace.neoRoot }));
    const invalid = spawnSync(process.execPath, [cli, 'project', 'run', '--dry-run', '--url', 'https://source.example/item', '--project=content-distribution'], {
      cwd: f.base, encoding: 'utf8', env: { ...process.env, NEO_WORKSPACE_CONFIG: config }
    });
    assert.notEqual(invalid.status, 0); assert.match(invalid.stderr, /Invalid Neo configuration/);
    assert.equal(relay.calls.length, 0);
  } finally { rmSync(f.base, { recursive: true, force: true }); }
});

test('package staging includes the project run entrypoint', async () => {
  const base = mkdtempSync(join(tmpdir(), 'neo-stage-'));
  try {
    const destination = join(base, 'dist');
    execFileSync(process.execPath, [join(root, 'scripts/stage-neo-cli.mjs'), destination], { encoding: 'utf8' });
    assert.ok(existsSync(join(destination, 'agents', 'visioner.agent.md')),
      'A standalone Neo CLI must include the reusable Visioner base Agent');
    assert.ok(existsSync(join(destination, 'scripts', 'eval-project-worker-prompts.mjs')),
      'Installed Neo Eval entry point must be present');
    assert.ok(existsSync(join(destination, 'scripts', 'audit-project-worker-evals.mjs')),
      'Installed Neo Eval Audit must be present');
    assert.equal(readFileSync(join(destination, '.bin/neo-project-run.mjs'), 'utf8').includes('runProject'), true);
    assert.equal(readFileSync(join(destination, '.bin/neo-run-git.mjs'), 'utf8').includes('commitRunStage'), true);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('foreground run streams real child output into terminal and private Run transcript', async () => {
  const f = fixture(), relay = relayStub();
  try {
    const fake = join(f.base, 'fake-relay.mjs');
    writeFileSync(fake, `process.stdout.write('shortcut.node {"type":"started","nodeId":"visioner"}\\n');\nprocess.stderr.write('shortcut.node {"type":"progress","nodeId":"visioner"}\\n');\nsetTimeout(() => { process.stdout.write('shortcut.node {"type":"completed","nodeId":"visioner"}\\n'); process.exit(0); }, 35);\n`);
    let snapshotDuringExecution = null;
    const stdout = [], stderr = [];
    const result = await runProject(['--path', f.runDir, '--project', 'vlog'], {
      workspace: f.workspace, runRelay: relay.runRelay,
      relayCli: fake, emit: chunk => { stdout.push(chunk); if (chunk.includes('"started"')) snapshotDuringExecution = { started: true, completed: stdout.join('').includes('"completed"') }; },
      error: chunk => stderr.push(chunk),
    });
    assert.equal(result, 2, 'a zero process exit without a durable completed Job must fail');
    assert.deepEqual(snapshotDuringExecution, { started: true, completed: false });
    assert.match(stdout.join(''), /"completed"/);
    assert.match(stderr.join(''), /"progress"/);
    const transcript = join(f.runDir, 'neo-project-run.log');
    const log = readFileSync(transcript, 'utf8');
    assert.match(log, /"started"/); assert.match(log, /"progress"/); assert.match(log, /"completed"/);
    assert.equal(statSync(transcript).mode & 0o077, 0);
    assert.equal(relay.calls.filter(x => x[0] === 'job' && x[1] === 'run').length, 0, 'default execution is an OS process, not a hidden synchronous stub');
  } finally { rmSync(f.base, { recursive: true, force: true }); }
});

test('foreground execution propagates blocked, timeout and interrupted child exit codes', async () => {
  for (const exitCode of [1, 3, 4, 5]) {
    const f = fixture(), relay = relayStub();
    try {
      const fake = join(f.base, 'fake-relay.mjs');
      writeFileSync(fake, `process.stderr.write('terminal failure\\n'); process.exit(${exitCode});\n`);
      const result = await runProject(['--path', f.runDir, '--project', 'vlog'], {
        workspace: f.workspace, runRelay: relay.runRelay, relayCli: fake,
        emit() {}, error() {},
      });
      assert.equal(result, exitCode);
    } finally { rmSync(f.base, { recursive: true, force: true }); }
  }
});

test('foreground child can be observed concurrently by tailing the same Run log', async () => {
  const f = fixture(), relay = relayStub();
  try {
    const fake = join(f.base, 'fake-relay.mjs');
    writeFileSync(fake, `process.stdout.write('phase-one\\n'); setTimeout(() => { process.stdout.write('phase-two\\n'); process.exit(3) }, 150);\n`);
    let notify;
    const observed = new Promise(resolve => { notify = resolve; });
    const running = runProject(['--path', f.runDir, '--project', 'vlog'], {
      workspace: f.workspace, runRelay: relay.runRelay, relayCli: fake,
      emit: text => { if (text.includes('phase-one')) notify(readFileSync(join(f.runDir, 'neo-project-run.log'), 'utf8')); },
      error() {},
    });
    assert.match(await observed, /phase-one/);
    assert.equal(await running, 3);
    assert.match(readFileSync(join(f.runDir, 'neo-project-run.log'), 'utf8'), /phase-two/);
  } finally { rmSync(f.base, { recursive: true, force: true }); }
});

test('a completed bound Run is idempotent and does not relaunch Relay', async () => {
  const f = fixture(), relay = relayStub();
  try {
    const args = ['--path', f.runDir, '--project', 'vlog'];
    await run(args, f, relay);
    assert.equal(relay.calls.filter(x => x[0] === 'job' && x[1] === 'run').length, 1);
    const output = JSON.parse(await run(args, f, relay));
    assert.equal(output.verified, true);
    assert.equal(relay.calls.filter(x => x[0] === 'job' && x[1] === 'run').length, 1);
  } finally { rmSync(f.base, { recursive: true, force: true }); }
});


test('private Vlog --no-review renders only with source approval, preserves policy across resume',async()=>{
  const f=fixture(),relay=relayStub();
  try{
    const source={schema_version:1,source_use:{approved:true,scope:'private test only'},media:[{id:'a'}]};
    writeFileSync(join(f.runDir,'source-manifest.json'),JSON.stringify(source));
    const args=['--project','vlog','--path',f.runDir,'--no-review'];
    const runId=JSON.parse(await run(args,f,relay));
    assert.equal(runId.taskId,'content-run');
    const mode=JSON.parse(readFileSync(join(f.runDir,'review-mode.json'),'utf8'));
    assert.deepEqual(mode,{schemaVersion:1,mode:'private-render-test',reviewStatus:'UNREVIEWED',
      humanReview:'NOT_RUN',specialistReview:'NOT_RUN',publicationAllowed:false});
    assert.equal(statSync(join(f.runDir,'review-mode.json')).mode&0o777,0o600);
    assert.match(readFileSync(join(f.runDir,'neo-project-run.input.md'),'utf8'),/SKIP human Preview and specialist review/);
    assert.equal(JSON.parse(await run(args,f,relay)).jobId,runId.jobId);
    await assert.rejects(()=>run(['--project','vlog','--path',f.runDir],f,relay),/Cannot change existing bound Vlog review policy/);
    assert.equal(relay.calls.filter(x=>x[0]==='job'&&x[1]==='create').length,1);
  }finally{rmSync(f.base,{recursive:true,force:true});}
});

test('private render mode rejects unapproved source or unrelated projects',async()=>{
  const f=fixture(),relay=relayStub();
  try{
    await assert.rejects(()=>run(['--project','vlog','--path',f.runDir,'--no-review'],f,relay),/source-manifest/);
    writeFileSync(join(f.runDir,'source-manifest.json'),JSON.stringify({source_use:{approved:false,scope:'private test'}}));
    await assert.rejects(()=>run(['--project','vlog','--path',f.runDir,'--no-review'],f,relay),/owner-approved/);
    await assert.rejects(()=>run(['--project','content-distribution','--url','https://example.com/test','--no-review'],f,relay),/only supported/);
    assert.equal(relay.calls.length,0);
  }finally{rmSync(f.base,{recursive:true,force:true});}
});

test('default Vlog run skips interactive review, routes conditional Publisher, never assumes authorization',async()=>{
 const f=fixture(),relay=relayStub();
 try{
  await run(['--project','vlog','--path',f.runDir],f,relay);
  const task=readFileSync(join(f.runDir,'neo-project-run.input.md'),'utf8');
  assert.match(task,/Default: no human interactive review/);
  assert.match(task,/Editor must run Markcut verify and noninteractive source\/asset checks/);
  assert.match(task,/no real viewer required/);
  assert.match(task,/Publisher.*SKIPPED/);
  assert.match(task,/Publisher itself has no review/);
  assert.equal(readdirSync(f.runDir).includes('review-mode.json'),false,'normal no-review must not be private-test policy');
 }finally{rmSync(f.base,{recursive:true,force:true});}
});

test('independent local-only project binds Relay to its own Git root without GitHub', async () => {
  const f = fixture(), relay = relayStub();
  try {
    execFileSync('git', ['init', '-q', f.content]);
    assert.equal(realpathSync(f.workspace.neoRoot), realpathSync(join(f.workspace.neoRoot)));
    const result = JSON.parse(await run(['--url', 'https://example.test/independent', '--project', 'content-distribution'], f, relay));
    assert.equal(result.project, 'content-distribution');
    const create = relay.calls.find(argv => argv[0] === 'job' && argv[1] === 'create');
    assert.deepEqual(create.slice(2, 6), ['--repo', 'local/content-distribution', '--project-path', '.']);
    assert.ok(create.includes('--no-github'));
    const runCall = relay.calls.find(argv => argv[0] === 'job' && argv[1] === 'run');
    assert.equal(runCall[runCall.indexOf('--project-path') + 1], realpathSync(f.content));
    assert.ok(runCall.includes('--no-github'));
    assert.equal(runCall[runCall.indexOf('--shared-root') + 1], f.workspace.harnessRoot);
    assert.equal(runCall[runCall.indexOf('--workspace-root') + 1], f.workspace.neoRoot);
    assert.equal(relay.jobs.get('job-1').state, 'COMPLETED');
  } finally { rmSync(f.base, { recursive: true, force: true }); }
});
