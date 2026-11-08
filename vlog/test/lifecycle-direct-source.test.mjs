import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, readFileSync, existsSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const vlog = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fakeNpx = `#!/usr/bin/env node
const fs=require('node:fs');
const args=process.argv.slice(4); // npx --no-install pm2 <action>
const stateFile=process.env.FAKE_PM2_STATE;
const read=()=>JSON.parse(fs.readFileSync(stateFile,'utf8'));
const write=x=>fs.writeFileSync(stateFile,JSON.stringify(x));
let state=read();
const [action,...options]=args;
if(action==='--version'){console.log('7.0.4');process.exit(0);}
if(action==='jlist'){console.log(JSON.stringify(state.process ? [state.process]: []));process.exit(0);}
if(action==='pid'){console.log(state.process?.pid ?? 0);process.exit(0);}
if(action==='save'){process.exit(0);}
if(action==='delete'){state.process=null;write(state);process.exit(0);}
if(action==='stop'){
 if(!state.process)process.exit(1);
 state.process.pm2_env.status='stopped';state.process.pid=0;write(state);process.exit(0);
}
if(action==='restart'){
 if(!state.process)process.exit(1);
 state.process.pm2_env.status='online';state.process.pid=++state.counter;write(state);process.exit(0);
}
if(action==='start'){
 const flag=(n)=>options[options.indexOf(n)+1];
 state.process={name:flag('--name'),pid:++state.counter,pm2_env:{status:'online',pm_exec_path:options[0],pm_cwd:flag('--cwd')}};
 write(state);process.exit(0);
}
console.error('unexpected fake PM2 action',args);process.exit(1);
`;

function sandbox({ legacy = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'vlog-lifecycle-source-'));
  const project = join(dir, 'vlog');
  mkdirSync(join(project, 'scripts'), { recursive: true });
  mkdirSync(join(project, 'lib'));
  mkdirSync(join(project, 'runs'));
  mkdirSync(join(dir, 'bin'));
  mkdirSync(join(dir, 'inbox'));
  writeFileSync(join(project, 'scripts/vlog-inbox-watcher.mjs'), "import '../lib/inbox-watcher.mjs';\n");
  writeFileSync(join(project, 'lib/inbox-watcher.mjs'), 'export const ok = true;\n');
  writeFileSync(join(project, 'runs/keep-media.mov'), 'original media stays');
  copyFileSync(join(vlog, 'neo-project'), join(project, 'neo-project'));
  const npx = join(dir, 'bin/npx');
  writeFileSync(npx, fakeNpx, { mode: 0o755 });
  chmodSync(npx, 0o755);
  const stateFile = join(dir, 'state.json');
  writeFileSync(stateFile, JSON.stringify({ counter: 2000, process: legacy ? {
    name: 'vlog/watcher', pid: 2000, pm2_env: {
      status: 'online', pm_exec_path: '/opt/homebrew/bin/npx', pm_cwd: join(project, 'runs/.service')
    }
  } : null }));
  const env = { ...process.env, PATH: join(dir, 'bin') + delimiter + process.env.PATH,
    FAKE_PM2_STATE: stateFile, VLOG_ICLOUD_INBOX: join(dir, 'inbox'), VLOG_RUNS_DIR: join(project, 'runs') };
  const call = (cmd) => {
    const result = spawnSync('bash', [join(project, 'neo-project'), cmd], { env, encoding: 'utf8' });
    return { code: result.status, stdout: result.stdout, stderr: result.stderr };
  };
  const state = () => JSON.parse(readFileSync(stateFile, 'utf8'));
  return { dir, project, call, state, close: () => rmSync(dir, { recursive: true, force: true }) };
}

test('Vlog lifecycle uses canonical lib/scripts; setup, start, restart, stop, uninstall are idempotent and preserve media', () => {
  const box = sandbox();
  try {
    assert.equal(box.call('setup').code, 0);
    assert.equal(existsSync(join(box.project, 'runs/.service')), false);
    assert.equal(box.call('start').code, 0);
    const oldPid = box.state().process.pid;
    assert.equal(box.state().process.pm2_env.pm_exec_path, join(box.project, 'scripts/vlog-inbox-watcher.mjs'));
    assert.equal(box.state().process.pm2_env.pm_cwd, box.project);
    assert.equal(JSON.parse(box.call('status').stdout).source, 'project-scripts');
    assert.equal(box.call('health').code, 0);
    assert.equal(box.call('start').code, 0);
    assert.equal(box.state().process.pid, oldPid, 'idempotent start does not restart');
    assert.equal(box.call('restart').code, 0);
    assert.notEqual(box.state().process.pid, oldPid, 'restart loads updated source');
    assert.equal(box.call('stop').code, 0);
    assert.equal(JSON.parse(box.call('status').stdout).running, false);
    assert.notEqual(box.call('health').code, 0);
    assert.equal(box.call('start').code, 0);
    assert.equal(box.call('health').code, 0);
    assert.equal(box.call('uninstall').code, 0);
    assert.equal(box.state().process, null);
    assert.equal(readFileSync(join(box.project, 'runs/keep-media.mov'), 'utf8'), 'original media stays');
    assert.equal(existsSync(join(box.project, 'runs/.service')), false);
  } finally { box.close(); }
});

test('start recognizes a running legacy npx/.tgz watcher and migrates it to the source entrypoint', () => {
  const box = sandbox({ legacy: true });
  try {
    assert.equal(JSON.parse(box.call('status').stdout).source, 'legacy-or-other');
    assert.notEqual(box.call('health').code, 0, 'legacy source is not healthy after contract migration');
    const first = box.call('start');
    assert.equal(first.code, 0, first.stderr);
    assert.equal(JSON.parse(first.stdout).source, 'project-scripts');
    assert.equal(box.call('health').code, 0);
    assert.equal(readFileSync(join(box.project, 'runs/keep-media.mov'), 'utf8'), 'original media stays');
  } finally { box.close(); }
});

test('Neo Project contract specifies local source and no duplicated packaged runtime', () => {
  const skill = readFileSync(resolve(vlog, '../skills/neo-project/SKILL.md'), 'utf8');
  const lifecycle = readFileSync(resolve(vlog, 'neo-project'), 'utf8');
  assert.match(skill, /<project>\/scripts\//);
  assert.match(skill, /<project>\/lib\//);
  assert.match(skill, /do not `npm pack`/);
  assert.doesNotMatch(lifecycle, /npm pack|--package|\.tgz/);
});
