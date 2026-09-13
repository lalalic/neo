#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-handoff-package-'));
for (const terminal of ['done', 'failed']) {
  const inbox = path.join(root, 'inbox'), processing = path.join(root, 'processing'), destination = path.join(root, terminal), task = path.join(inbox, `task-${terminal}`);
  fs.mkdirSync(task, { recursive: true }); fs.mkdirSync(processing, { recursive: true }); fs.mkdirSync(destination, { recursive: true });
  fs.writeFileSync(path.join(task, 'HANDOFF.md'), 'request'); fs.writeFileSync(path.join(task, 'STATE'), 'NEW'); fs.writeFileSync(path.join(task, 'RETURNED.txt'), 'returned artifact');
  const claimed = path.join(processing, path.basename(task)); fs.renameSync(task, claimed); fs.writeFileSync(path.join(claimed, 'STATE'), 'RUNNING'); fs.writeFileSync(path.join(claimed, 'STATUS.md'), `State: ${terminal.toUpperCase()}`); fs.writeFileSync(path.join(claimed, 'STATE'), terminal.toUpperCase()); fs.renameSync(claimed, path.join(destination, path.basename(task)));
  assert.equal(fs.readFileSync(path.join(destination, path.basename(task), 'STATE'), 'utf8'), terminal.toUpperCase());
}
const inbox = path.join(root, 'inbox'), processing = path.join(root, 'processing'), done = path.join(root, 'done'), task = path.join(inbox, 'task-review');
fs.mkdirSync(task); fs.writeFileSync(path.join(task, 'HANDOFF.md'), 'request'); fs.writeFileSync(path.join(task, 'STATE'), 'NEW'); fs.renameSync(task, path.join(processing, 'task-review')); fs.writeFileSync(path.join(processing, 'task-review', 'STATE'), 'REVIEW'); fs.renameSync(path.join(processing, 'task-review'), path.join(done, 'task-review')); fs.writeFileSync(path.join(done, 'task-review', 'STATE'), 'REVISION_REQUESTED'); fs.renameSync(path.join(done, 'task-review'), task);
assert.equal(fs.readFileSync(path.join(task, 'STATE'), 'utf8'), 'REVISION_REQUESTED'); fs.rmSync(root, { recursive: true });
console.log('bidirectional package lifecycle tests passed');
