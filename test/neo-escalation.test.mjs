import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildEscalationPrompt, codexArgs, parseEscalationArgs, runEscalation } from '../.bin/neo.mjs';

test('defaults user notification instruction to WeChat File Helper with iMessage fallback', () => {
  const parsed = parseEscalationArgs([
    '--intent', 'finish release',
    '--blocked-on', 'MFA required'
  ]);
  assert.match(parsed.onNeedsUser, /wechat-bro/i);
  assert.match(parsed.onNeedsUser, /File Helper/);
  assert.match(parsed.onNeedsUser, /iMessage/);
  assert.match(parsed.onNeedsUser, /user themself/);
});

test('caller-provided user notification instruction overrides the default', () => {
  const parsed = parseEscalationArgs([
    '--intent', 'finish release',
    '--blocked-on', 'MFA required',
    '--on-needs-user', 'Use Discord channel #ops.'
  ]);
  assert.equal(parsed.onNeedsUser, 'Use Discord channel #ops.');
});

test('parseEscalationArgs accepts optional user notification instruction', () => {
  const parsed = parseEscalationArgs([
    '--intent', 'publish extension',
    '--blocked-on', 'identity verification',
    '--context', 'publisher tab is already open',
    '--on-needs-user', 'Use wechat-bro to notify File Helper and verify delivery.',
    '--cwd', '/tmp/example'
  ]);
  assert.equal(parsed.intent, 'publish extension');
  assert.equal(parsed.blockedOn, 'identity verification');
  assert.match(parsed.onNeedsUser, /wechat-bro/);
  assert.equal(parsed.cwd, '/tmp/example');
});

test('Codex invocation uses elevated local execution permissions at the top level', () => {
  const args = codexArgs({ cwd: '/tmp/example' });
  assert.deepEqual(args.slice(0, 5), ['--sandbox', 'danger-full-access', '--ask-for-approval', 'never', 'exec']);
  assert.ok(args.includes('--output-schema'));
  assert.deepEqual(args.slice(-3), ['-C', '/tmp/example', '-']);
});

test('prompt requires self-resolution before needs_user and carries fallback verbatim', () => {
  const prompt = buildEscalationPrompt({
    intent: 'finish release',
    blockedOn: 'verification prompt',
    context: 'authenticated browser exists',
    onNeedsUser: 'Send iMessage to the user with the exact action.'
  }, 'First solve the blocker. Only use needs_user for genuinely non-delegable actions.');
  assert.match(prompt, /First solve the blocker/);
  assert.match(prompt, /Send iMessage to the user with the exact action/);
  assert.match(prompt, /on_needs_user/);
});

test('runEscalation parses resolved structured output', () => {
  let observed;
  const result = runEscalation({
    intent: 'push branch', blockedOn: 'caller permission denied', cwd: '/tmp', codexCommand: 'codex'
  }, {
    agentContract: 'Resolve it and return JSON.',
    spawnSyncImpl(command, args, options) {
      observed = { command, args, options };
      return { status: 0, stdout: JSON.stringify({ status: 'resolved', summary: 'pushed', evidence: ['remote ref exists'] }), stderr: '' };
    }
  });
  assert.equal(observed.command, 'codex');
  assert.match(observed.options.input, /push branch/);
  assert.equal(result.status, 'resolved');
});

test('needs_user requires a concrete human action', () => {
  assert.throws(() => runEscalation({ intent: 'x', blockedOn: 'y', cwd: '/tmp' }, {
    agentContract: 'Return JSON.',
    spawnSyncImpl() {
      return { status: 0, stdout: JSON.stringify({ status: 'needs_user', summary: 'MFA remains' }), stderr: '' };
    }
  }), /requires user_action/);
});


test('CLI executes when invoked through an npm-style symlink', () => {
  const dir = mkdtempSync(join(tmpdir(), 'neo-cli-symlink-'));
  const link = join(dir, 'neo');
  symlinkSync(resolve('.bin/neo.mjs'), link);
  const output = execFileSync(link, ['escalation', '--help'], { encoding: 'utf8' });
  assert.match(output, /neo escalation --intent TEXT --blocked-on TEXT/);
});
