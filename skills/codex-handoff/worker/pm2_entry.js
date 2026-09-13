#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');

for (;;) {
  spawnSync(process.execPath, [path.join(__dirname, 'handoff.js'), 'worker'], { stdio: 'inherit' });
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60_000);
}
