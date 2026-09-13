#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
for (const args of [['pm2', 'startOrReload', 'ecosystem.config.cjs', '--update-env'], ['pm2', 'save']]) {
  const result = spawnSync(npx, args, { cwd: root, stdio: 'inherit' });
  if (result.status) process.exit(result.status);
}
console.log('codex-handoff-worker started/reloaded under PM2');
