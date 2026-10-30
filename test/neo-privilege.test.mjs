import test from 'node:test';
import assert from 'node:assert/strict';
import { executePrivilege, HELPER } from '../.bin/neo-privilege.mjs';

function harness({ installed = true, reply = { code: 0, stdout: 'ok\n', stderr: '' } } = {}) {
  const calls = [], stdout = [], stderr = [];
  const options = {
    installed,
    invoke: (binary, args) => { calls.push({ binary, args }); return reply; },
    emit: text => stdout.push(text),
    fail: text => stderr.push(text),
  };
  return { calls, stdout, stderr, options };
}

test('privilege list reads only the fixed helper binary without sudo', () => {
  const h = harness({ reply: { code: 0, stdout: 'dns.flush\nvpn.server.status\n', stderr: '' } });
  assert.equal(executePrivilege(['list'], h.options), 0);
  assert.deepEqual(h.calls, [{ binary: HELPER, args: ['list'] }]);
  assert.deepEqual(JSON.parse(h.stdout[0]).actions, ['dns.flush', 'vpn.server.status']);
});

test('privilege status uses fresh no-prompt sudo with fixed helper and safe check', () => {
  const h = harness();
  assert.equal(executePrivilege(['status'], h.options), 0);
  assert.equal(JSON.parse(h.stdout[0]).state, 'ready');
  assert.deepEqual(h.calls, [{ binary: '/usr/bin/sudo', args: ['-n', '-k', HELPER, 'check', 'dns.flush'] }]);
});

test('privilege run only passes an operation name, never a shell command', () => {
  const h = harness();
  assert.equal(executePrivilege(['run', 'vpn.server.status'], h.options), 0);
  assert.deepEqual(h.calls, [{ binary: '/usr/bin/sudo', args: ['-n', '-k', HELPER, 'run', 'vpn.server.status'] }]);
  assert.deepEqual(h.stdout, ['ok\n']);
  for (const evil of ['/bin/sh', 'dns.flush;id', 'dns.flush extra', '../etc/passwd', '-u']) {
    const t = harness();
    assert.throws(() => executePrivilege(['run', evil], t.options), /Denied/);
    assert.deepEqual(t.calls, []);
  }
  assert.throws(() => executePrivilege(['run', 'dns.flush', 'extra'], h.options), /usage/);
});

test('unsupported actions are refused by the signed helper, not silently approved', () => {
  const h = harness({ reply: { code: 64, stdout: '', stderr: 'DENIED\n' } });
  assert.equal(executePrivilege(['run', 'unapproved.action'], h.options), 64);
  assert.deepEqual(h.stderr, ['DENIED\n']);
});

test('missing helper and sudo denial do not obtain credentials or invoke commands', () => {
  const absent = harness({ installed: false });
  assert.equal(executePrivilege(['run', 'dns.flush'], absent.options), 2);
  assert.equal(JSON.parse(absent.stdout[0]).state, 'not_installed');
  assert.deepEqual(absent.calls, []);
  const denied = harness({ reply: { code: 1, stdout: '', stderr: 'sudo: a password is required\n' } });
  assert.equal(executePrivilege(['status'], denied.options), 2);
  assert.equal(JSON.parse(denied.stdout[0]).state, 'authorization_required');
});
