import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, chmodSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

const neo = resolve('.bin/neo.mjs');

test('neo gpu forwards subcommands without shell interpolation', () => {
  const dir = mkdtempSync(join(tmpdir(),'neo-gpu-dispatch-'));
  try {
    const stub = join(dir,'mock-neo-gpu');
    writeFileSync(stub, '#!/bin/sh\nprintf "%s\\n" "$@"\n');
    chmodSync(stub, 0o700);
    const run = spawnSync(process.execPath,
      [neo,'gpu','lip-sync','--demo','--output','a file.mp4','--dry-run'],
      {encoding:'utf8',env:{...process.env,PATH:dir+':'+process.env.PATH,NEO_GPU_CLI:'mock-neo-gpu'}});
    assert.equal(run.status,0,run.stderr);
    assert.deepEqual(run.stdout.trim().split('\n'),
      ['lip-sync','--demo','--output','a file.mp4','--dry-run']);
  } finally {
    rmSync(dir,{recursive:true,force:true});
  }
});

test('neo gpu fails cleanly when provider is absent', () => {
  const run = spawnSync(process.execPath,[neo,'gpu','doctor'],{
    encoding:'utf8',
    env:{...process.env,NEO_GPU_CLI:'this-executable-is-not-installed'}
  });
  assert.equal(run.status,1);
  assert.match(run.stderr,/GPU provider not installed/);
});
