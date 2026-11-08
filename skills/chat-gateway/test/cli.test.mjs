import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { symlink } from 'node:fs/promises';
import { parseArgs, setupSteps } from '../cli/chat-gateway.mjs';
import { fixture } from './helpers.mjs';

test('CLI parses flags and constructs one authorized serviceman definition', () => {
  assert.deepEqual(parseArgs(['setup', '--package', '/tmp/example.tgz', '--apply']).words, ['setup']);
  assert.throws(() => parseArgs(['setup', '--invalid']));
  const steps = setupSteps({ config: { port: 8791 }, packageSpec: '/tmp/example.tgz' });
  assert.deepEqual(steps.service.slice(0, 7), ['serviceman', 'define', '--skill', 'chat-gateway', '--service', 'server', '--apply']);
  assert.match(steps.federation, /127\.0\.0\.1:8791/);
});

test('setup and env set have no disk writes unless --apply is provided', async (t) => {
  const { dir } = await fixture(t);
  const stateDir = `${dir}/no-write`;
  const env = { ...process.env, CHAT_GATEWAY_STATE_DIR: stateDir };
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
  const output = execFileSync(link, ['setup'], { encoding: 'utf8' });
  assert.equal(JSON.parse(output).dryRun, true);
});
