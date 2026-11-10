import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { symlink } from 'node:fs/promises';
import { parseArgs, setupSteps } from '../cli/chat-gateway.mjs';
import { fixture } from './helpers.mjs';

test('CLI setup uses canonical source and never a packaged service', () => {
  assert.deepEqual(parseArgs(['setup', '--apply']).words, ['setup']);
  assert.throws(() => parseArgs(['setup', '--package', '/tmp/example.tgz']));
  const steps = setupSteps({ config: { port: 8791 } });
  assert.equal(steps.service[0], 'bash');
  assert.match(steps.service[1], /skills\/chat-gateway\/neo-project$/);
  assert.match(steps.source, /skills\/chat-gateway\/cli\/chat-gateway\.mjs$/);
  assert.match(steps.federation, /127\.0\.0\.1:8791/);
  assert.ok(!JSON.stringify(steps).includes('.tgz'));
});

test('direct-source lifecycle refuses live start from a disposable worktree', () => {
  const script = readFileSync(new URL('../neo-project', import.meta.url), 'utf8');
  assert.match(script, /assert_canonical/);
  assert.match(script, /Refusing to start chat-gateway/);
  assert.match(script, /pm2 start.*ENTRYPOINT/);
  assert.match(script, /--interpreter none -- serve/);
  assert.match(script, /p.interpreter==="none"/);
  assert.match(script, /await_health/);
  assert.match(script, /pm2 delete.*SERVICE/);
  assert.doesNotMatch(script, /npm pack|--package|\.tgz/);
});

test('setup and env set have no disk writes unless --apply is provided', async (t) => {
  const { dir } = await fixture(t);
  const stateDir = `${dir}/no-write`;
  const env = { ...process.env, CHAT_GATEWAY_STATE_DIR: stateDir, EVENTS_BUS_CONFIG: `${dir}/test-events-not-configured.json` };
  const path = new URL('../cli/chat-gateway.mjs', import.meta.url).pathname;
  const setup = JSON.parse(execFileSync(process.execPath, [path, 'setup'], { env, encoding: 'utf8' }));
  const override = JSON.parse(execFileSync(process.execPath, [path, 'env', 'set', 'home'], { env, encoding: 'utf8' }));
  assert.equal(setup.dryRun, true);
  assert.equal(override.dryRun, true);
  assert.equal(existsSync(stateDir), false);
});


test('npm-style symlink launcher executes rather than silently exits', async (t) => {
  const { dir } = await fixture(t);
  const target = new URL('../cli/chat-gateway.mjs', import.meta.url).pathname;
  const link = `${dir}/chat-gateway`;
  await symlink(target, link);
  const output = execFileSync(link, ['setup'], { encoding: 'utf8', env: { ...process.env, EVENTS_BUS_CONFIG: `${dir}/test-events-not-configured.json` } });
  assert.equal(JSON.parse(output).dryRun, true);
});
