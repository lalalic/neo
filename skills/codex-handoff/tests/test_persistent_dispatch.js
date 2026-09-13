#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const state = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-persistent-state-'));
const worker = path.resolve(__dirname, '../worker/handoff.js');
const run = (...args) => spawnSync(process.execPath, [worker, 'persistent', ...args], { encoding: 'utf8', env: { ...process.env, CODEX_HANDOFF_STATE_DIR: state } });
assert.equal(run('lookup', 'missing').stdout.trim(), '');
assert.equal(run('store', 'alpha', 'thread-1').status, 0);
assert.equal(run('lookup', 'alpha').stdout.trim(), 'thread-1');
assert.notEqual(run('store', 'alpha', 'thread-2').status, 0);
assert.equal(run('store', 'beta', 'thread-3').status, 0);
const lock = run('lock', 'alpha').stdout.trim();
assert.equal(fs.existsSync(lock), true);
assert.notEqual(run('lock', 'alpha').status, 0);
fs.rmSync(lock, { recursive: true }); fs.rmSync(state, { recursive: true });
console.log('persistent dispatch tests passed');
