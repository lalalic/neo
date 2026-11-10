import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const neo=resolve(fileURLToPath(new URL('../.bin/neo.mjs',import.meta.url)));

test('neo gpu uses the built-in Node module without a separately installed neo-gpu',()=>{
  const result=spawnSync(process.execPath,[neo,'gpu','help'],{encoding:'utf8',
    env:{...process.env,NEO_GPU_CLI:'this-executable-is-not-installed'}});
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/neo gpu build/);
  assert.match(result.stdout,/neo gpu run/);
  assert.doesNotMatch(result.stdout,/install the neo-gpu CLI/);
});

test('neo gpu rejects unknown subcommands without invoking provider tools',()=>{
  const result=spawnSync(process.execPath,[neo,'gpu','unknown-command'],{encoding:'utf8',
    env:{...process.env,PATH:'/does-not-exist'}});
  assert.equal(result.status,2);
  assert.match(result.stderr,/Unknown neo gpu command/);
});
