import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNotifyCommand, reportNotification, sanitizeText } from '../core/notify.mjs';
import { terminalTurn } from '../core/terminal-dispatch.mjs';

test('terminal turn contains only job metadata and asks Orchestrator to verify', () => {
  const text = terminalTurn({
    jobId: '123', to: 'COMPLETED', title: 'A useful title', repository: 'neo',
    terminalUpdatedAt: '2026-11-10T19:00:00.000Z',
    objective: 'THIS_OBJECTIVE_IS_SECRET', path: '/private/sensitive/file',
    secret: 'THIS_KEY_IS_SECRET', prompt: 'THIS_PROMPT_IS_SECRET',
  });
  assert.match(text, /A useful title/);
  assert.match(text, /Relay Job/);
  assert.match(text, /chat_report/);
  assert.match(text, /123/);
  for (const bad of ['THIS_OBJECTIVE', '/private/sensitive', 'THIS_KEY', 'THIS_PROMPT']) {
    assert.equal(text.includes(bad), false);
  }
  assert.equal(reportNotification([{ text: 'Verified result', needs: 'phone' }]).kind, 'blocked');
});

test('Neo setup command is validated, bounded and never interprets shell metacharacters', () => {
  assert.equal(sanitizeText('hello\nworld', 20), 'hello world');
  const command = buildNotifyCommand({ kind: 'completed', title: 'a"\\`$;token', body: 'okay\nfor owner' });
  assert.match(command, /^events notify completed/);
  assert.equal(command.includes('"\\`$'), false);
  assert.throws(() => buildNotifyCommand({ kind: 'unauthorized', title: 'x', body: 'y' }));
});
