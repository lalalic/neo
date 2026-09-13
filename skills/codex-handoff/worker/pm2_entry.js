#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const interval = Number(process.env.CODEX_HANDOFF_INTERVAL_MS || 60_000);
for (;;) {
  const started = Date.now();
  spawnSync(process.execPath, [path.join(__dirname, 'handoff.js'), 'worker'], { stdio: 'inherit' });
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(0, interval - (Date.now() - started)));
}
