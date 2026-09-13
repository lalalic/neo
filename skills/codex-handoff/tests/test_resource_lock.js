#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const state = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-resource-state-'));
const worker = path.resolve(__dirname, '../worker/handoff.js');
const env = { ...process.env, CODEX_HANDOFF_STATE_DIR: state };
const run = (...args) => spawnSync(process.execPath, [worker, 'resource', ...args], { encoding: 'utf8', env });
const staleMutex = path.join(state, 'resource-locks', '.mutex');
fs.mkdirSync(staleMutex, { recursive: true }); fs.writeFileSync(path.join(staleMutex, 'pid'), '999999');
const one = run('acquire', 'workspace', 'neo/vlog', 'neo', String(process.pid)).stdout.trim();
const two = run('acquire', 'workspace', 'neo/other', 'neo', String(process.pid)).stdout.trim();
assert.equal(fs.existsSync(one) && fs.existsSync(two) && !fs.existsSync(staleMutex), true);
const blocked = spawn(process.execPath, [worker, 'resource', 'acquire', 'workspace', 'neo/vlog', 'neo', '999993'], { env });
setTimeout(() => {
  assert.equal(blocked.exitCode, null);
  blocked.kill(); run('release', one); run('release', two);
  const repo = run('acquire', 'repo', 'neo', 'neo', String(process.pid)).stdout.trim();
  const blockedRepo = spawn(process.execPath, [worker, 'resource', 'acquire', 'workspace', 'neo/vlog', 'neo', '999994'], { env });
  setTimeout(() => { assert.equal(blockedRepo.exitCode, null); blockedRepo.kill(); run('release', repo); fs.rmSync(state, { recursive: true }); console.log('resource lock tests passed'); }, 250);
}, 250);
