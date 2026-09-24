import test from 'node:test';
import assert from 'node:assert/strict';
import { PackageServiceUpdater, publicationFromEvent } from '../scripts/package-service-updater.mjs';

function event(overrides = {}) {
  return {
    version: 1,
    job_id: 'job-1',
    orchestrator_id: 'xchat',
    task_id: 'release',
    type: 'package.published',
    status: 'succeeded',
    data: {
      package: 'agents-relay',
      version: '1.2.3',
      registry: 'https://registry.npmjs.org',
      repository: 'lalalic/agents-relay',
      prNumber: 83,
    },
    ...overrides,
  };
}

function harness({ config = { packages: { 'agents-relay': { pm2Service: 'agents-relay', settleMs: 0 } } }, execute, state = { deployed: {} } } = {}) {
  const calls = [];
  const events = [];
  const states = [];
  const defaultExecute = (command, args) => {
    calls.push([command, ...args]);
    if (command === 'npm') return { code: 0, stdout: '1.2.3\n', stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
  const updater = new PackageServiceUpdater({
    config,
    state,
    execute: execute ?? defaultExecute,
    sleep: async () => {},
    emit: async (_input, type, status, message, data) => events.push({ type, status, message, data }),
    saveState: async state => states.push(JSON.parse(JSON.stringify(state))),
  });
  return { updater, calls, events, states };
}

test('publication parser accepts only successful package.published events', () => {
  assert.equal(publicationFromEvent(event())?.packageName, 'agents-relay');
  assert.equal(publicationFromEvent(event({ type: 'github.webhook' })), null);
  assert.equal(publicationFromEvent(event({ status: 'failed' })), null);
});

test('unconfigured publication is ignored without process mutation', async () => {
  const { updater, calls, events } = harness({ config: { packages: {} } });
  assert.deepEqual(await updater.handle(event()), { action: 'ignored', reason: 'unconfigured-package' });
  assert.deepEqual(calls, []);
  assert.deepEqual(events, []);
});

test('publication wake deploys current registry latest and deduplicates stale or duplicate wakes', async () => {
  const calls = [];
  const config = { packages: { 'agents-relay': {
    pm2Service: 'agents-relay',
    settleMs: 0,
    healthCommand: ['curl', '-fsS', 'http://127.0.0.1:4400/healthz'],
    versionCommand: ['agents-relay', '--version'],
  } } };
  const { updater, events, states } = harness({
    config,
    execute(command, args) {
      calls.push([command, ...args]);
      if (command === 'npm' && args[1] === 'agents-relay@1.2.3') return { code: 0, stdout: '1.2.3\n', stderr: '' };
      if (command === 'npm' && args[1] === 'agents-relay') return { code: 0, stdout: '1.2.4\n', stderr: '' };
      if (command === 'agents-relay') return { code: 0, stdout: '1.2.4\n', stderr: '' };
      return { code: 0, stdout: 'ok\n', stderr: '' };
    },
  });

  assert.deepEqual(await updater.handle(event()), {
    action: 'deployed',
    package: 'agents-relay',
    publicationVersion: '1.2.3',
    version: '1.2.4',
    service: 'agents-relay',
  });
  assert.deepEqual(calls, [
    ['npm', 'view', 'agents-relay@1.2.3', 'version', '--registry=https://registry.npmjs.org'],
    ['npm', 'view', 'agents-relay', 'version', '--registry=https://registry.npmjs.org'],
    ['npx', 'pm2', 'restart', 'agents-relay'],
    ['curl', '-fsS', 'http://127.0.0.1:4400/healthz'],
    ['agents-relay', '--version'],
    ['npx', 'pm2', 'save'],
  ]);
  assert.deepEqual(events.map(item => item.type), ['service.deploy.started', 'service.deploy.completed']);
  assert.equal(events[0].data.publicationVersion, '1.2.3');
  assert.equal(events[0].data.deployVersion, '1.2.4');
  assert.equal(states.at(-1).deployed['agents-relay'], '1.2.4');

  const restartCount = calls.filter(call => call.join(' ') === 'npx pm2 restart agents-relay').length;
  assert.deepEqual(await updater.handle(event()), { action: 'ignored', reason: 'already-deployed', version: '1.2.4' });
  assert.equal(calls.filter(call => call.join(' ') === 'npx pm2 restart agents-relay').length, restartCount);
  assert.deepEqual(calls.slice(-2), [
    ['npm', 'view', 'agents-relay@1.2.3', 'version', '--registry=https://registry.npmjs.org'],
    ['npm', 'view', 'agents-relay', 'version', '--registry=https://registry.npmjs.org'],
  ]);
});

test('non-pullable exact version fails before PM2 restart and is not persisted', async () => {
  const calls = [];
  const { updater, events, states } = harness({
    execute(command, args) {
      calls.push([command, ...args]);
      return { code: 0, stdout: '1.2.2\n', stderr: '' };
    },
  });
  const result = await updater.handle(event());
  assert.equal(result.action, 'failed');
  assert.match(result.error, /not pullable/);
  assert.deepEqual(calls, [['npm', 'view', 'agents-relay@1.2.3', 'version', '--registry=https://registry.npmjs.org']]);
  assert.deepEqual(events.map(item => item.type), ['service.deploy.failed']);
  assert.deepEqual(states, []);
});

test('failed post-restart verification emits failure and never pm2 save or completion', async () => {
  const calls = [];
  const config = { packages: { 'agents-relay': {
    pm2Service: 'agents-relay',
    settleMs: 0,
    healthCommand: ['health-check'],
    verifyAttempts: 1,
  } } };
  const { updater, events, states } = harness({
    config,
    execute(command, args) {
      calls.push([command, ...args]);
      if (command === 'npm' && args[1] === 'agents-relay@1.2.3') return { code: 0, stdout: '1.2.3\n', stderr: '' };
      if (command === 'npm' && args[1] === 'agents-relay') return { code: 0, stdout: '1.2.3\n', stderr: '' };
      if (command === 'health-check') return { code: 1, stdout: '', stderr: 'not ready' };
      return { code: 0, stdout: '', stderr: '' };
    },
  });
  const result = await updater.handle(event());
  assert.equal(result.action, 'failed');
  assert.equal(calls.some(call => call.join(' ') === 'npx pm2 save'), false);
  assert.deepEqual(events.map(item => item.type), ['service.deploy.started', 'service.deploy.failed']);
  assert.deepEqual(states, []);
});

test('stale publication does not roll back or restart when latest is already deployed', async () => {
  const calls = [];
  const { updater, events, states } = harness({
    state: { deployed: { 'agents-relay': '1.2.4' } },
    execute(command, args) {
      calls.push([command, ...args]);
      if (command === 'npm' && args[1] === 'agents-relay@1.2.3') return { code: 0, stdout: '1.2.3\n', stderr: '' };
      if (command === 'npm' && args[1] === 'agents-relay') return { code: 0, stdout: '1.2.4\n', stderr: '' };
      throw new Error('unexpected mutation command');
    },
  });
  assert.deepEqual(await updater.handle(event()), { action: 'ignored', reason: 'already-deployed', version: '1.2.4' });
  assert.deepEqual(calls, [
    ['npm', 'view', 'agents-relay@1.2.3', 'version', '--registry=https://registry.npmjs.org'],
    ['npm', 'view', 'agents-relay', 'version', '--registry=https://registry.npmjs.org'],
  ]);
  assert.deepEqual(events, []);
  assert.deepEqual(states, []);
});
