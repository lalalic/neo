import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
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
  for (const [dir, declaration] of [[content, { schemaVersion: 1, input: { type: 'url', schemes: ['https'], resumePath: true } }], [vlog, { schemaVersion: 1, input: { type: 'path', path: { base: 'runs', datedRunDirectory: true } } }]]) {
    writeFileSync(join(dir, 'AGENTS.md'), 'project policy');
    writeFileSync(join(dir, 'README.md'), 'project readme');
    writeFileSync(join(dir, 'graph.mmd'), 'flowchart TD\n  a --> b\n');
    writeFileSync(join(dir, 'project.run.json'), JSON.stringify(declaration));
  }
  mkdirSync(join(vlog, 'runs', '2026-11-03-episode'), { recursive: true });
  return { base, workspace: { workspaceRoot, neoRoot }, content, vlog, runDir: join(vlog, 'runs', '2026-11-03-episode') };
}
function relayStub() {
  const calls = [], jobs = new Map(), tasks = new Map(); let next = 0; const failures = new Set();
  return {
    calls, jobs, tasks, failures,
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
function run(args, f, relay, extra = {}) {
  const output = [];
  runProject(args, { workspace: f.workspace, runRelay: relay.runRelay, emit: value => output.push(value), now: new Date('2026-11-03T12:00:00Z'), ...extra });
  return output.join('');
}

test('URL input supports both flag forms, keeps token private, and delegates exact graph', () => {
  const f = fixture(), relay = relayStub();
  try {
    const out = run(['--url=https://rsroot.com/xxxid?token=secret-token', '--project', 'content-distribution'], f, relay);
    const result = JSON.parse(out);
    assert.equal(result.project, 'content-distribution'); assert.equal(result.jobId, 'job-1'); assert.equal(result.taskId, 'content-run');
    assert.equal(out.includes('secret-token'), false);
    assert.equal(out.includes('rsroot.com'), false);
    assert.equal(result.runPath.includes('rsroot.com'), false);
    assert.deepEqual(relay.calls.map(x => x.slice(0, 2)), [['job', 'create'], ['task', 'create']]);
    const job = relay.calls[0], task = relay.calls[1];
    assert.deepEqual(job.slice(2), ['--repo', 'lalalic/neo', '--project-path', 'content-distribution', '--objective-file', join(result.runPath, 'neo-project-run.objective.md'), '--shortcut-execution']);
    assert.deepEqual(task.slice(-2), ['--agent-graph-file', realpathSync(join(f.content, 'graph.mmd'))]);
    assert.equal(task[task.indexOf('--output-path') + 1], join(result.runPath, 'neo-project-run.result.json'));
    assert.equal(relay.calls.flat().some(value => value.includes('secret-token') || value.includes('rsroot.com')), false);
    assert.equal(readFileSync(join(result.runPath, 'source-reference.json'), 'utf8').includes('secret-token'), true);
    assert.equal(readFileSync(join(result.runPath, 'neo-project-run.objective.md'), 'utf8').includes('secret-token'), false);
    assert.equal(statSync(join(result.runPath, 'source-reference.json')).mode & 0o777, 0o600);
    assert.equal(statSync(result.runPath).mode & 0o777, 0o700);
  } finally { rmSync(f.base, { recursive: true, force: true }); }
});

test('path input creates one run binding and a repeated invocation verifies instead of duplicating', () => {
  const f = fixture(), relay = relayStub();
  try {
    const args = ['--project=vlog', '--path', f.runDir];
    const first = JSON.parse(run(args, f, relay));
    const second = JSON.parse(run(['--path=' + f.runDir, '--project=vlog'], f, relay));
    assert.equal(first.jobId, second.jobId); assert.equal(first.taskId, second.taskId); assert.equal(second.runPath, first.runPath);
    assert.equal(relay.calls.filter(x => x[0] === 'job' && x[1] === 'create').length, 1);
    assert.equal(relay.calls.filter(x => x[0] === 'task' && x[1] === 'create').length, 1);
    assert.deepEqual(relay.calls.slice(2).map(x => x.slice(0, 2)), [['job', 'show'], ['task', 'list']]);
  } finally { rmSync(f.base, { recursive: true, force: true }); }
});

test('a saved Job binding resumes missing Task creation after a Relay failure', () => {
  const f = fixture(), relay = relayStub();
  try {
    relay.failures.add('task:create');
    assert.throws(() => run(['--path', f.runDir, '--project', 'vlog'], f, relay), /stub task:create failure/);
    const binding = JSON.parse(readFileSync(join(f.runDir, '.neo-project-run.json'), 'utf8'));
    assert.equal(binding.jobId, 'job-1'); assert.equal(binding.taskId, 'content-run');
    relay.failures.delete('task:create');
    const out = JSON.parse(run(['--path', f.runDir, '--project', 'vlog'], f, relay));
    assert.equal(out.jobId, 'job-1'); assert.equal(relay.calls.filter(x => x[0] === 'job' && x[1] === 'create').length, 1);
    assert.equal(relay.calls.filter(x => x[0] === 'task' && x[1] === 'create').length, 2);
    assert.equal(relay.tasks.get('job-1').length, 1);
    assert.equal(relay.tasks.get('job-1')[0].id, 'content-run');
  } finally { rmSync(f.base, { recursive: true, force: true }); }
});

test('rejects a tampered private binding that points Relay input outside the selected run', () => {
  const f = fixture(), relay = relayStub();
  try {
    const binding = join(f.runDir, '.neo-project-run.json');
    writeFileSync(binding, JSON.stringify({ schemaVersion: 1, project: 'vlog', runPath: f.runDir, jobId: 'job-1', taskId: 'content-run', taskInput: '/tmp/private.md' }));
    chmodSync(binding, 0o600);
    assert.throws(() => run(['--project', 'vlog', '--path', f.runDir], f, relay), /binding does not match/);
    assert.equal(relay.calls.length, 0);
  } finally { rmSync(f.base, { recursive: true, force: true }); }
});

test('URL project resumes a bound private run by path without another Job', () => {
  const f = fixture(), relay = relayStub();
  try {
    relay.failures.add('task:create');
    assert.throws(() => run(['--url', 'https://rsroot.com/episode?token=secret', '--project', 'content-distribution'], f, relay), /stub task:create failure/);
    const runDir = join(f.content, 'runs', readdirSync(join(f.content, 'runs'))[0]);
    const saved = JSON.parse(readFileSync(join(runDir, '.neo-project-run.json'), 'utf8'));
    assert.equal(saved.jobId, 'job-1');
    relay.failures.delete('task:create');
    const resumed = JSON.parse(run(['--path=' + runDir, '--project=content-distribution'], f, relay));
    assert.equal(resumed.jobId, 'job-1');
    assert.equal(JSON.parse(run(['--path', runDir, '--project', 'content-distribution'], f, relay)).verified, true);
    assert.equal(relay.calls.filter(args => args[0] === 'job' && args[1] === 'create').length, 1);
    assert.equal(relay.tasks.get('job-1').length, 1);
    const empty = join(f.content, 'runs', '2026-11-03-empty'); mkdirSync(empty);
    assert.throws(() => run(['--path', empty, '--project', 'content-distribution'], f, relay), /only an existing bound Run/);
  } finally { rmSync(f.base, { recursive: true, force: true }); }
});

test('existing Relay Job and Task must match Run binding before reuse', () => {
  const f = fixture(), relay = relayStub(), args = ['--project=vlog', '--path', f.runDir];
  try {
    run(args, f, relay);
    const job = relay.jobs.get('job-1');
    job.projectPath = 'another-project';
    assert.throws(() => run(args, f, relay), /does not match this content-only project/);
    job.projectPath = 'vlog';
    const task = relay.tasks.get('job-1')[0];
    for (const [property, value] of [['input', 'unrelated input'], ['agentGraph', 'flowchart TD\nC[agent:wrong]'], ['output', {kind:'file', path:'/tmp/unrelated'}]]) {
      const original = task[property]; task[property] = value;
      assert.throws(() => run(args, f, relay), /does not match this canonical Run/);
      task[property] = original;
    }
    const binding = join(f.runDir, '.neo-project-run.json');
    const original = JSON.parse(readFileSync(binding, 'utf8'));
    writeFileSync(binding, JSON.stringify({...original, repository:'other/repo'})); chmodSync(binding, 0o600);
    assert.throws(() => run(args, f, relay), /different Relay repository/);
  } finally { rmSync(f.base, { recursive: true, force: true }); }
});

test('dry-run validates without writes or Relay calls', () => {
  const f = fixture(), relay = relayStub();
  try {
    const out = JSON.parse(run(['--dry-run', '--project', 'content-distribution', '--url', 'https://rsroot.com/a?secret=abc'], f, relay));
    assert.equal(out.dryRun, true); assert.equal('sourceHost' in out, false);
    assert.equal(out.runPath.includes('rsroot.com'), false); assert.equal(out.runPath.includes('secret'), false);
    assert.equal(relay.calls.length, 0); assert.equal(statSync(join(f.content, 'runs'), { throwIfNoEntry: false }), undefined);
  } finally { rmSync(f.base, { recursive: true, force: true }); }
});

test('rejects bad argument combinations, URL forms, unconfigured project, missing graph, and path escapes', () => {
  const f = fixture(), relay = relayStub();
  try {
    writeFileSync(join(f.workspace.neoRoot, '.git'), 'gitdir: ../.git/worktrees/source');
    assert.throws(() => run(['--project', 'vlog', '--path', f.runDir], f, relay), /linked Git worktree/);
    rmSync(join(f.workspace.neoRoot, '.git'));
    for (const args of [[], ['--project', 'vlog'], ['--project', 'vlog', '--path', f.runDir, '--url', 'https://x.test'], ['--project', '../vlog', '--url', 'https://x.test']])
      assert.throws(() => run(args, f, relay));
    for (const url of ['http://example.test/a', 'https://user:pass@example.test/a', 'not a url', 'https://example.test/\n', 'https://example.test/%zz'])
      assert.throws(() => run(['--project', 'content-distribution', '--url', url], f, relay));
    assert.throws(() => run(['--project', 'content-distribution', '--path', f.runDir], f, relay), /run path does not exist|inside this project runs/);
    assert.throws(() => run(['--project', 'vlog', '--path', f.runDir + '/../2026-11-03-episode'], f, relay), /traversal/);
    const media = join(f.vlog, 'runs', '2026-11-03-media.mp4'); writeFileSync(media, 'media');
    assert.throws(() => run(['--project', 'vlog', '--path', media], f, relay), /run directory/);
    const external = join(f.base, 'outside'); mkdirSync(external); mkdirSync(join(external, '2026-11-03-outside'));
    symlinkSync(external, join(f.vlog, 'runs', 'outside-link'));
    assert.throws(() => run(['--project', 'vlog', '--path', join(f.vlog, 'runs', 'outside-link', '2026-11-03-outside')], f, relay), /inside this project runs/);
    writeFileSync(join(f.content, 'graph.mmd'), '');
    const unsupported = join(f.workspace.neoRoot, 'no-config'); mkdirSync(unsupported);
    for (const file of ['AGENTS.md', 'README.md', 'graph.mmd']) writeFileSync(join(unsupported, file), 'x');
    assert.throws(() => run(['--project', 'no-config', '--url', 'https://example.test'], f, relay), /missing required project.run.json/);
    rmSync(join(f.vlog, 'graph.mmd'));
    assert.throws(() => run(['--project', 'vlog', '--path', f.runDir], f, relay), /missing required graph.mmd/);
    assert.equal(relay.calls.length, 0);
  } finally { rmSync(f.base, { recursive: true, force: true }); }
});

test('CLI help and legacy project resolution remain available', () => {
  const help = execFileSync(process.execPath, [join(root, '.bin/neo.mjs'), 'project', 'run', '--help'], { encoding: 'utf8' });
  assert.match(help, /--dry-run/);
  const resolved = JSON.parse(execFileSync(process.execPath, [join(root, '.bin/neo.mjs'), 'project', 'resolve', 'neo'], { encoding: 'utf8' }));
  assert.equal(resolved.name, 'neo');
});

test('installed CLI resolves configured Neo root independently of cwd and rejects invalid workspace config', () => {
  const f = fixture(), relay = relayStub();
  try {
    const config = join(f.base, 'workspace.json');
    writeFileSync(config, JSON.stringify({ schemaVersion: 1, workspaceRoot: f.workspace.workspaceRoot }));
    const cli = join(root, '.bin/neo.mjs');
    const result = spawnSync(process.execPath, [cli, 'project', 'run', '--dry-run', '--url', 'https://source.example/item', '--project=content-distribution'], {
      cwd: f.base, encoding: 'utf8', env: { ...process.env, NEO_WORKSPACE_CONFIG: config }
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).project, 'content-distribution');
    assert.equal(result.stdout.includes(f.base), true);
    writeFileSync(config, JSON.stringify({ schemaVersion: 2, workspaceRoot: f.workspace.workspaceRoot }));
    const invalid = spawnSync(process.execPath, [cli, 'project', 'run', '--dry-run', '--url', 'https://source.example/item', '--project=content-distribution'], {
      cwd: f.base, encoding: 'utf8', env: { ...process.env, NEO_WORKSPACE_CONFIG: config }
    });
    assert.notEqual(invalid.status, 0); assert.match(invalid.stderr, /Invalid workspace configuration/);
    assert.equal(relay.calls.length, 0);
  } finally { rmSync(f.base, { recursive: true, force: true }); }
});

test('package staging includes the project run entrypoint', () => {
  const base = mkdtempSync(join(tmpdir(), 'neo-stage-'));
  try {
    const destination = join(base, 'dist');
    execFileSync(process.execPath, [join(root, 'scripts/stage-neo-cli.mjs'), destination], { encoding: 'utf8' });
    assert.equal(readFileSync(join(destination, '.bin/neo-project-run.mjs'), 'utf8').includes('runProject'), true);
  } finally { rmSync(base, { recursive: true, force: true }); }
});
