import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, symlinkSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEscalationArgs, readRequiredTextFile } from '../.bin/neo.mjs';

const agentPrompt = readFileSync(fileURLToPath(new URL('../agents/escalation.agent.md', import.meta.url)), 'utf8');

function tempFile(name, content) {
  const dir = mkdtempSync(join(tmpdir(), 'neo-escalation-'));
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}

test('reads one required free-form handoff file and applies default notification policy file', () => {
  const handoff = tempFile('handoff.md', '# Goal\nFinish the release.\n\nCurrent state: publishing is blocked.');
  const parsed = parseEscalationArgs(['--handoff-file', handoff]);
  assert.match(parsed.handoff, /Finish the release/);
  assert.match(parsed.onNeedsUser, /wechat-bro/i);
  assert.match(parsed.onNeedsUser, /File Helper/);
  assert.match(parsed.onNeedsUser, /iMessage/);
  assert.match(parsed.onNeedsUser, /phone-readable/);
});

test('default notification policy is loaded from the editable agent-side file', () => {
  const handoff = tempFile('handoff.md', 'Complete the authorization flow.');
  const customDefault = tempFile('default-notify.md', 'Default policy from file.');
  const parsed = parseEscalationArgs(['--handoff-file', handoff], { defaultNeedsUserPath: customDefault });
  assert.equal(parsed.onNeedsUser, 'Default policy from file.');
});

test('notification policy override is file-only', () => {
  const handoff = tempFile('handoff.md', 'Complete the authorization flow.');
  const notify = tempFile('notify.md', 'Use Discord channel #ops.');
  const parsed = parseEscalationArgs(['--handoff-file', handoff, '--on-needs-user-file', notify]);
  assert.equal(parsed.onNeedsUser, 'Use Discord channel #ops.');
});

test('missing or empty selected notification policy fails clearly', () => {
  const handoff = tempFile('handoff.md', 'Complete the authorization flow.');
  const empty = tempFile('notify.md', '   \n');
  assert.throws(() => parseEscalationArgs(['--handoff-file', handoff], { defaultNeedsUserPath: '/tmp/definitely-missing-needs-user-policy.md' }), /default needs-user policy could not be read/);
  assert.throws(() => parseEscalationArgs(['--handoff-file', handoff, '--on-needs-user-file', empty]), /--on-needs-user-file is empty/);
  assert.throws(() => readRequiredTextFile(empty, 'test policy'), /test policy is empty/);
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
  assert.throws(() => parseEscalationArgs(['--handoff-file', empty]), /--handoff-file is empty/);
});

test('deprecated backend selector and Codex CLI option are not accepted', () => {
  const handoff = tempFile('handoff.md', 'Complete the authorized local task.');
  assert.throws(() => parseEscalationArgs(['--handoff-file', handoff, '--codex-command', 'codex']), /unknown escalation option/);
});

test('local escalation prompt selects WebHelm, Neo Computer Use CLI, and Shell', () => {
  const prompt = agentPrompt;
  assert.match(prompt, /Execution path: WebHelm, Neo Computer Use, Shell/);
  assert.match(prompt, /\*\*WebHelm\*\*/);
  assert.match(prompt, /installed `webhelm` Skill on demand/);
  assert.match(prompt, /\*\*Neo Computer Use\*\*/);
  assert.match(prompt, /neo computer-use help/);
  assert.match(prompt, /neo computer-use call list_apps/);
  assert.match(prompt, /neo computer-use call get_app_state --args-file/);
  assert.match(prompt, /\*\*Shell\*\* directly/);
  assert.match(prompt, /not a `computer-use` Skill/);
  assert.match(prompt, /Do \*\*not\*\* call arbitrary Neo.app MCP tools/);
  assert.doesNotMatch(prompt, /browser-workspace|neoy\/computer|NeoY MCP/);
});

test('native UI evidence and interactive authorization avoid premature human escalation', () => {
  const prompt = agentPrompt;
  assert.match(prompt, /obtain `list_apps` and a fresh `get_app_state`/);
  assert.match(prompt, /background\/PTY process with observable output/);
  assert.match(prompt, /rejoin it and verify its outcome/);
  assert.match(prompt, /One failed tool does not establish `needs_user`/);
  assert.match(prompt, /clicked button.*not proof of completion/);
});

test('human fallback is only for irreducible steps and uses File Helper then iMessage', () => {
  const prompt = agentPrompt;
  assert.match(prompt, /genuinely requires the account owner's presence or decision/);
  assert.match(prompt, /wechat-bro → File Helper/);
  assert.match(prompt, /\*\*iMessage\*\*/);
  assert.match(prompt, /concise and phone-readable/);
  assert.match(prompt, /do not wait indefinitely for a human response/);
  assert.match(prompt, /return `needs_user` with a resumable action/);
  assert.match(prompt, /Return \*\*exactly one JSON object\*\*/);
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
  assert.doesNotMatch(output, /--codex-command/);
  assert.match(output, /neo escalation challenges/);
  assert.match(output, /--correlation-id ID/);
});


test('default needs-user policy is a human fallback, not a primary execution path', () => {
  const prompt = agentPrompt;
  assert.match(prompt, /Never notify before attempting authorized recovery/);
  assert.match(prompt, /\`on_needs_user\`/);
  assert.match(prompt, /If WeChat\/File Helper cannot deliver/);
});
