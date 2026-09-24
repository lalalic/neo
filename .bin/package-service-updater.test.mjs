import assert from 'node:assert/strict';
import { mkdtemp, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { handlePublicationEvent, waitUntilPullable } from './package-service-updater.mjs';

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
