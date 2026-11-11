import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import * as runGit from '../.bin/neo-run-git.mjs';

test('Review no longer exposes Git checkpoint or tag helpers',()=>{
 for(const name of ['commitRunPreview','assertReviewCheckpoint','tagRunReview'])
  assert.equal(Object.hasOwn(runGit,name),false);
 assert.equal(typeof runGit.commitRunStage,'function','verified Stage commits remain available');
});

test('Obsolete manual review checkpoint CLI remains unavailable',()=>{
 const cli=resolve(import.meta.dirname,'../.bin/neo.mjs');
 const result=spawnSync(process.execPath,[cli,'project','review','checkpoint'],{encoding:'utf8'});
 assert.notEqual(result.status,0);
 assert.match(result.stderr,/usage|unknown|requires/i);
});
