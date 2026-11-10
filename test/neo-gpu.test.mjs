import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const neo=resolve(fileURLToPath(new URL('../.bin/neo.mjs',import.meta.url)));

test('neo compute is the primary built-in Node CLI and neo gpu remains an alias',()=>{
  const result=spawnSync(process.execPath,[neo,'compute','help'],{encoding:'utf8',
    env:{...process.env,NEO_GPU_CLI:'this-executable-is-not-installed'}});
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/neo compute build/);
  assert.match(result.stdout,/neo compute run/);
  const alias=spawnSync(process.execPath,[neo,'gpu','help'],{encoding:'utf8'});
  assert.equal(alias.status,0,alias.stderr);
  assert.equal(alias.stdout,result.stdout);
  assert.doesNotMatch(result.stdout,/install the neo-gpu CLI/);
});

test('neo compute rejects unknown subcommands without invoking provider tools',()=>{
  const result=spawnSync(process.execPath,[neo,'compute','unknown-command'],{encoding:'utf8',
    env:{...process.env,PATH:'/does-not-exist'}});
  assert.equal(result.status,2);
  assert.match(result.stderr,/Unknown neo compute command/);
});

test('neo compute doctor and existing services never require GPU rental',()=>{
  for(const option of ['compute','gpu']){
    const result=spawnSync(process.execPath,[neo,option,'doctor'],{encoding:'utf8',timeout:12000});
    assert.equal(result.status,0,result.stderr);
    const doctor=JSON.parse(result.stdout);
    assert.equal(typeof doctor.node,'string');
    assert.equal(typeof doctor.hfCli,'boolean');
  }
});
