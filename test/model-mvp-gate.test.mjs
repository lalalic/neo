import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

const script=new URL('../services/models/mvp-gate.py',import.meta.url).pathname;
const python=(args)=>spawnSync('python3',[script,...args],{encoding:'utf8'});

test('MVP gate rejects invocation without candidate/live phase',t=>{
  const root=mkdtempSync(join(tmpdir(),'neo-mvp-gate-phase-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const result=python(['--base-url','http://127.0.0.1:8796/v1',
    '--state-dir',root,'--output-dir',root]);
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/required: --phase/);
});

test('live gate fails before any Codex request without matching candidate evidence',t=>{
  const root=mkdtempSync(join(tmpdir(),'neo-mvp-live-evidence-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const state=join(root,'state');mkdirSync(join(state,'sessions'),{recursive:true});
  const base=['--phase','live','--base-url','http://127.0.0.1:8769/v1',
    '--state-dir',state,'--output-dir',join(root,'evidence')];
  const missing=python(base);
  assert.notEqual(missing.status,0);
  assert.match(missing.stderr,/requires a prior ALL_3_MVPS_PASS candidate evidence file/);
  const file=join(root,'candidate.json');
  writeFileSync(file,JSON.stringify({gate:'ALL_3_MVPS_PASS',phase:'candidate',source_fingerprint:'old-build'}));
  const stale=python([...base,'--candidate-evidence',file]);
  assert.notEqual(stale.status,0);
  assert.match(stale.stderr,/candidate source differs from live source/);
  writeFileSync(file,JSON.stringify({gate:'FAIL',phase:'candidate',source_fingerprint:'old-build'}));
  const failed=python([...base,'--candidate-evidence',file]);
  assert.notEqual(failed.status,0);
  assert.match(failed.stderr,/candidate evidence does not contain all three MVP passes/);
});

test('MVP2 gate contains no speculative repeat Enter on pending second Turn',()=>{
  const source=requireSource();
  assert.match(source,/Exactly one Enter per Turn/);
  assert.doesNotMatch(source,/retries\s*</);
  assert.match(source,/validate_native_turn_count\(state, s1\['id'\], started_ms\)/);
});

function requireSource(){
  return spawnSync('cat',[script],{encoding:'utf8'}).stdout;
}
