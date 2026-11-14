import test from 'node:test';
import assert from 'node:assert/strict';
import { createReporter } from '../core/report.mjs';
import { TOOL_DEFS, validateReport } from '../mcp/tools.mjs';
import { fixture } from './helpers.mjs';

test('valid reports are persisted and attention alone is queued', async (t) => {
  const { ledger, clock } = await fixture(t);
  const reporter = createReporter({ ledger, now: clock.now });
  assert.equal((await reporter.report({ text: 'Status update' })).status, 'stored');
  assert.equal((await reporter.report({ text: 'Need phone', level: 'attention', needs: 'phone' })).status, 'pending');
  assert.equal(ledger.pending().length, 1);
  assert.equal(ledger.counts().stored, 1);
});

test('report validation requires nonempty bounded text and enumerated values', async (t) => {
  const { ledger } = await fixture(t);
  const reporter = createReporter({ ledger });
  for (const invalid of [null, {}, { text: ' ' }, { text: 'x'.repeat(2001) },
    { text: 'ok', level: 'critical' }, { text: 'ok', needs: 'internet' },
    { text: 'ok', secret: 'danger' }, { text: 'ok', jobId: '../secrets' }]) {
    await assert.rejects(reporter.report(invalid));
  }
  assert.equal(ledger.counts().total, 0);
  assert.equal(validateReport({ text: 'ok' }).value.level, 'info');
});

test('silence produces no report, notification or liveness state', async (t) => {
  const { ledger } = await fixture(t);
  createReporter({ ledger });
  assert.equal(ledger.all().length, 0);
});


test('chat_report tool advertises Markdown and Mermaid fenced chart format', () => {
  const tool = TOOL_DEFS.find(def => def.name === 'chat_report');
  assert.ok(tool);
  for (const field of [tool.description, tool.inputSchema.properties.text.description]) {
    assert.match(field, /Markdown/);
    assert.match(field, /```mermaid\nflowchart LR\nA\[Start\] --> B\[Done\]\n```/);
  }
  assert.match(tool.description, /Neo Mobile renders Mermaid locally/);
});
