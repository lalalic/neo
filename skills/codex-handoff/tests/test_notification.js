#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const worker = path.resolve(__dirname, '../worker/handoff.js');
const run = (...args) => spawnSync(process.execPath, [worker, 'notification', ...args], { encoding: 'utf8' });
assert.equal(run('render', '--event', 'done', '--task', 'task-123', '--summary', 'all good').stdout.trim(), '✅ Neo Handoff DONE — task-123 — all good');
assert.equal(run('render', '--event', 'failed', '--task', 'task-123').stdout.trim(), '❌ Neo Handoff FAILED — task-123');
assert.equal(run('should-notify', '--notification', 'imessage', '--events', 'done,failed', '--event', 'done').status, 0);
assert.notEqual(run('should-notify', '--notification', 'none', '--events', 'done,failed', '--event', 'done').status, 0);
const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-notification-')), 'notification.log');
const result = spawnSync(process.execPath, [worker, 'notification', 'notify', '--notification', 'imessage', '--events', 'done,failed', '--event', 'failed', '--task', 'task-123', '--summary', 'error', '--dry-run'], { encoding: 'utf8', env: { ...process.env, CODEX_HANDOFF_NOTIFICATION_LOG: log } });
assert.equal(result.stdout.trim(), '❌ Neo Handoff FAILED — task-123 — error');
assert.equal(fs.existsSync(log), false);
console.log('handoff notification tests passed');
