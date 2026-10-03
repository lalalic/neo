import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildEscalationPrompt, codexArgs, parseEscalationArgs, runEscalation } from '../.bin/neo.mjs';

function tempFile(name, content) {
  const dir = mkdtempSync(join(tmpdir(), 'neo-escalation-'));
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}

test('reads one required free-form handoff file and applies default notification policy', () => {
  const handoff = tempFile('handoff.md', '# Goal\nFinish the release.\n\nCurrent state: publishing is blocked.');
  const parsed = parseEscalationArgs(['--handoff-file', handoff]);
  assert.match(parsed.handoff, /Finish the release/);
  assert.match(parsed.onNeedsUser, /wechat-bro/i);
  assert.match(parsed.onNeedsUser, /File Helper/);
  assert.match(parsed.onNeedsUser, /iMessage/);
  assert.match(parsed.onNeedsUser, /phone-readable/);
});

test('notification policy override is file-only', () => {
  const handoff = tempFile('handoff.md', 'Complete the authorization flow.');
  const notify = tempFile('notify.md', 'Use Discord channel #ops.');
  const parsed = parseEscalationArgs(['--handoff-file', handoff, '--on-needs-user-file', notify]);
  assert.equal(parsed.onNeedsUser, 'Use Discord channel #ops.');
});

test('rejects stdin and inline or legacy task-content options', () => {
  assert.throws(() => parseEscalationArgs(['--handoff-file', '-']), /requires a file path/);
  for (const option of ['--handoff', '--intent', '--intent-file', '--blocked-on', '--blocked-on-file', '--context', '--context-file', '--on-needs-user']) {
    assert.throws(() => parseEscalationArgs([option, 'x']), /use --handoff-file PATH/);
  }
});

test('requires a non-empty handoff file', () => {
  const empty = tempFile('handoff.md', '   \n');
  assert.throws(() => parseEscalationArgs([]), /requires --handoff-file PATH/);
  assert.throws(() => parseEscalationArgs(['--handoff-file', empty]), /requires --handoff-file PATH/);
});

test('prompt carries one handoff payload plus notification policy', () => {
  const prompt = buildEscalationPrompt({
    handoff: 'Finish the release. Current blocker is a verification prompt. Completion means registry is updated.',
    onNeedsUser: 'Send iMessage to the user with the exact action.'
  }, 'First solve the blocker. Only use needs_user for genuinely non-delegable actions.');
  assert.match(prompt, /First solve the blocker/);
  assert.match(prompt, /Finish the release/);
  assert.match(prompt, /"handoff"/);
  assert.match(prompt, /"on_needs_user"/);
  assert.doesNotMatch(prompt, /"intent"/);
  assert.doesNotMatch(prompt, /"blocked_on"/);
  assert.doesNotMatch(prompt, /"context"/);
});

test('Codex invocation uses elevated local execution permissions at the top level', () => {
  const args = codexArgs({ cwd: '/tmp/example' });
  assert.deepEqual(args.slice(0, 2), ['-c', 'mcp_servers.neoy.url=\"http://127.0.0.1:6767/mcp\"']);
  assert.deepEqual(args.slice(2, 7), ['--sandbox', 'danger-full-access', '--ask-for-approval', 'never', 'exec']);
  assert.ok(args.includes('--output-schema'));
  assert.deepEqual(args.slice(-3), ['-C', '/tmp/example', '-']);
});

test('Codex invocation accepts an explicit NeoY MCP URL override', () => {
  const args = codexArgs({ cwd: '/tmp/example', neoyMcpUrl: 'http://127.0.0.1:9999/mcp' });
  assert.deepEqual(args.slice(0, 2), ['-c', 'mcp_servers.neoy.url=\"http://127.0.0.1:9999/mcp\"']);
});

test('runEscalation parses resolved structured output', () => {
  let observed;
  const result = runEscalation({
    handoff: 'Push the branch after resolving the caller permission issue.', cwd: '/tmp', codexCommand: 'codex'
  }, {
    agentContract: 'Resolve it and return JSON.',
    spawnSyncImpl(command, args, options) {
      observed = { command, args, options };
      return { status: 0, stdout: JSON.stringify({ status: 'resolved', summary: 'pushed', evidence: ['remote ref exists'] }), stderr: '' };
    }
  });
  assert.equal(observed.command, 'codex');
  assert.match(observed.options.input, /Push the branch/);
  assert.equal(result.status, 'resolved');
});

test('needs_user requires a concrete human action', () => {
  assert.throws(() => runEscalation({ handoff: 'Complete the flow.', cwd: '/tmp' }, {
    agentContract: 'Return JSON.',
    spawnSyncImpl() {
      return { status: 0, stdout: JSON.stringify({ status: 'needs_user', summary: 'MFA remains' }), stderr: '' };
    }
  }), /requires user_action/);
});

test('default agent contract makes Computer Use and Browser Workspace primary before needs_user', () => {
  const prompt = buildEscalationPrompt({ handoff: 'Enable the System Settings permission and verify it.', cwd: '/tmp' });
  assert.match(prompt, /primary tools are \*\*Computer Use\*\* and \*\*Browser Workspace\*\*/);
  assert.match(prompt, /must attempt it yourself with Computer Use or Browser Workspace before considering `needs_user`/);
  assert.match(prompt, /permission toggle, unlock button, browser authorization screen, or settings page is not by itself proof/);
  assert.match(prompt, /unknown password\/secret, OTP\/MFA, biometric check/);
});

test('default agent contract requires mobile-friendly user notifications', () => {
  const prompt = buildEscalationPrompt({ handoff: 'Complete authorization; only a human-only OTP may remain.', cwd: '/tmp' });
  assert.match(prompt, /concise and phone-readable/);
  assert.match(prompt, /short bullet list or a small ASCII status block/);
});

test('CLI help exposes only file-based content inputs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'neo-cli-symlink-'));
  const link = join(dir, 'neo');
  symlinkSync(resolve('.bin/neo.mjs'), link);
  const output = execFileSync(link, ['escalation', '--help'], { encoding: 'utf8' });
  assert.match(output, /neo escalation --handoff-file PATH/);
  assert.match(output, /--on-needs-user-file PATH/);
  assert.doesNotMatch(output, /--intent/);
  assert.doesNotMatch(output, /--blocked-on/);
  assert.doesNotMatch(output, /--context/);
  assert.doesNotMatch(output, /--handoff TEXT/);
});
