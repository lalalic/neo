import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNotifyCommand, jobNotification, jobSummaryNotification, sanitizeText } from '../core/notify.mjs';

test('job notification contains only title, state, job id, repository', () => {
  const message = jobNotification({
    jobId: '123', to: 'COMPLETED', title: 'A useful title', repository: 'neo',
    objective: 'THIS_OBJECTIVE_IS_SECRET', path: '/private/sensitive/file',
    secret: 'THIS_KEY_IS_SECRET', prompt: 'THIS_PROMPT_IS_SECRET',
  });
  const text = `${message.title}\n${message.body}`;
  assert.match(text, /A useful title/);
  assert.match(text, /completed/);
  assert.match(text, /123/);
  for (const bad of ['THIS_OBJECTIVE', '/private/sensitive', 'THIS_KEY', 'THIS_PROMPT']) {
    assert.equal(text.includes(bad), false);
  }
  assert.equal(jobNotification({ jobId: '123', to: 'CANCELLED' }).kind, 'completed');
  assert.match(jobNotification({ jobId: '123', to: 'CANCELLED' }).title, /cancelled/);
  assert.equal(jobSummaryNotification(Array.from({ length: 6 }, (_, i) => ({ jobId: String(i) }))).title, '6 jobs finished');
});

test('Neo setup command is validated, bounded and never interprets shell metacharacters', () => {
  assert.equal(sanitizeText('hello\nworld', 20), 'hello world');
  const command = buildNotifyCommand({ kind: 'completed', title: 'a"\\`$;token', body: 'okay\nfor owner' });
  assert.match(command, /^events notify completed/);
  assert.equal(command.includes('"\\`$'), false);
  assert.throws(() => buildNotifyCommand({ kind: 'unauthorized', title: 'x', body: 'y' }));
});
