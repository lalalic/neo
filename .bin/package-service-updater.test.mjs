import assert from 'node:assert/strict';
import { mkdtemp, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { handlePublicationEvent, waitUntilPullable, waitUntilLatest, discoverPackageServices } from './package-service-updater.mjs';

const publication = {
  type: 'package.published',
  status: 'succeeded',
  data: { package: '@neo/example', version: '1.2.3', registry: 'https://registry.example.test' },
};

test('metadata-like readiness does not authorize restart until npm pack succeeds', async () => {
  const created = [];
  const commands = [];
  let attempts = 0;
  const makeTempDir = async () => {
    const directory = await mkdtemp(join(tmpdir(), 'neo-updater-test-'));
    created.push(directory);
    if (attempts >= 1) await writeFile(join(directory, 'neo-example-1.2.3.tgz'), 'tarball');
    return directory;
  };
  await waitUntilPullable('@neo/example', '1.2.3', 'https://registry.example.test', {
    timeoutMs: 100,
    pollIntervalMs: 1,
    makeTempDir,
    run(command, args) {
      commands.push({ command, args });
      attempts += 1;
      if (attempts < 2) return { code: 1, stdout: '1.2.3\n', stderr: '404 tarball not found' };
      return { code: 0, stdout: 'neo-example-1.2.3.tgz\n', stderr: '' };
    },
  });

  assert.equal(attempts, 2);
  assert.ok(commands.every(({ command, args }) => command === 'npm' && args[0] === 'pack'));
  assert.ok(commands.every(({ args }) => args.includes('--registry=https://registry.example.test')));
  for (const directory of created) await assert.rejects(stat(directory), /ENOENT/);
});

test('artifact timeout leaves the running service untouched', async () => {
  let restarts = 0;
  await assert.rejects(() => handlePublicationEvent(publication, {
    waitUntilPullable: async () => { throw new Error('artifact was not fetchable within 10ms (last=404)'); },
    waitUntilLatest: async () => {},
    pm2List: () => [{
      name: 'example-service',
      pm2_env: { status: 'online', pm_exec_path: '/usr/local/bin/npx', args: ['-p', '@neo/example@1.2.2'] },
    }],
    restart: () => { restarts += 1; return { code: 0, stdout: '', stderr: '' }; },
  }));
  assert.equal(restarts, 0);
});

test('restart happens only after artifact verification succeeds', async () => {
  const order = [];
  const result = await handlePublicationEvent(publication, {
    waitUntilPullable: async () => { order.push('artifact'); },
    waitUntilLatest: async () => {},
    pm2List: () => [{
      name: 'example-service',
      pm2_env: { status: 'online', pm_exec_path: '/usr/local/bin/npx', args: ['-p', '@neo/example@1.2.2'] },
    }],
    restart: () => { order.push('restart'); return { code: 0, stdout: '', stderr: '' }; },
    waitUntilOnline: async () => { order.push('online'); },
    emit: async (_event, type) => { if (type === 'service.deploy.completed') order.push('completed'); },
  });

  assert.deepEqual(order, ['artifact', 'restart', 'online', 'completed']);
  assert.deepEqual(result.results, [{ service: 'example-service', status: 'completed' }]);
});

test('latest dist-tag must match published package before restarting', async () => {
  const observed=[];
  let polls=0;
  await waitUntilLatest('@neo/example','1.2.3','https://registry.example.test',{
    timeoutMs:100,pollIntervalMs:1,
    run(command,args){
      observed.push([command,...args]);
      polls+=1;
      return {code:0,stdout:polls===1?'1.2.2\n':'1.2.3\n',stderr:''};
    },
  });
  assert.equal(polls,2);
  assert.ok(observed.every(x=>x.includes('--prefer-online')));
});

test('unmatched latest dist-tag prevents stale publication from restarting a service', async () => {
  let restarts=0;
  await assert.rejects(() => handlePublicationEvent(publication,{
    waitUntilPullable:async()=>{},
    waitUntilLatest:async()=>{throw new Error('stale publication');},
    pm2List:()=>[{name:'example',pm2_env:{status:'online',pm_exec_path:'/usr/bin/npx',args:['--package','@neo/example@latest']}}],
    restart:()=>{restarts++;return {code:0,stderr:''};},
  }),/stale publication/);
  assert.equal(restarts,0);
});


test('watcher identifies direct npx @latest launchers and avoids unrelated services', () => {
  const process = (name, launcher, args) => ({
    name, pm2_env: { status: 'online', pm_exec_path: launcher, args },
  });
  const inventory = [
    process('wechat-bro/daemon', '/opt/homebrew/bin/npx', ['-y', 'wechat-bro@latest', '--daemon', '--port', '9231']),
    process('wechat-bro/orchestrator', '/opt/homebrew/bin/npx', ['-y', 'wechat-bro@latest', 'orchestrator']),
    process('agents-relay/daemon', '/opt/homebrew/bin/npx', ['-y', '--package', 'agents-relay@latest', 'agents-relayd']),
    process('other/npx', '/opt/homebrew/bin/npx', ['--yes', '@unrelated/pkg@latest', '--command', 'wechat-bro@latest']),
    process('vlog/watcher', '/opt/homebrew/bin/npx', ['-y', '--package', '/tmp/vlog-0.1.1.tgz', 'vlog-inbox-watcher']),
    process('other/local', '/usr/bin/node', ['/tmp/wechat-bro@latest.mjs']),
  ];
  assert.deepEqual(discoverPackageServices(inventory, 'wechat-bro').map(x => x.name),
    ['wechat-bro/daemon', 'wechat-bro/orchestrator']);
  assert.deepEqual(discoverPackageServices(inventory, 'agents-relay').map(x => x.name),
    ['agents-relay/daemon']);
  assert.deepEqual(discoverPackageServices(inventory, '@unrelated/pkg').map(x => x.name),
    ['other/npx']);
});

test('published direct npx package restarts both PM2 services after artifact and latest verification', async () => {
  const order = [];
  const result = await handlePublicationEvent({
    type: 'package.published',
    status: 'succeeded',
    data: { package: 'wechat-bro', version: '3.1.5' },
  }, {
    waitUntilPullable: async () => { order.push('artifact'); },
    waitUntilLatest: async () => { order.push('latest'); },
    pm2List: () => [
      { name: 'wechat-bro/daemon', pm2_env: { status: 'online', pm_exec_path: '/opt/homebrew/bin/npx', args: ['-y', 'wechat-bro@latest', '--daemon'] } },
      { name: 'wechat-bro/orchestrator', pm2_env: { status: 'online', pm_exec_path: '/opt/homebrew/bin/npx', args: ['-y', 'wechat-bro@latest', 'orchestrator'] } },
    ],
    restart: () => { order.push('restart'); return { code: 0, stderr: '' }; },
    waitUntilOnline: async name => { order.push('online:' + name); },
    emit: async () => {},
  });
  assert.deepEqual(order, ['artifact', 'latest', 'restart', 'online:wechat-bro/daemon', 'restart', 'online:wechat-bro/orchestrator']);
  assert.deepEqual(result.results, [
    { service: 'wechat-bro/daemon', status: 'completed' },
    { service: 'wechat-bro/orchestrator', status: 'completed' },
  ]);
});
