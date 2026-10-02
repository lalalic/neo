import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEscalationPrompt, codexArgs, parseEscalationArgs, runEscalation } from '../.bin/neo.mjs';

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
