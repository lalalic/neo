import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
test('synthetic story-first pilot produces complete no-GPS and optionally GPS-enriched drafts deterministically',()=>{
 const d=mkdtempSync(join(tmpdir(),'vlog-synthetic-'));
 try{
  const run=()=>{execFileSync(process.execPath,[new URL('../scripts/synthetic-story-pilot.mjs',import.meta.url).pathname,d]);return ['no-gps','gps-enhanced'].map(name=>readFileSync(join(d,name,'assertions.json'),'utf8'))};
  const first=run(),second=run();assert.deepEqual(first,second);
  const [none,withGps]=first.map(JSON.parse);
  assert.equal(none.beats.length,3);assert.equal(none.mapIncluded,false);assert.equal(none.productionReady,false);
  assert.equal(withGps.beats.length,3);assert.equal(withGps.mapIncluded,true);assert.match(withGps.routeScene,/view:route/);assert.equal(withGps.trackedMovement,false);assert.equal(withGps.publishAuthorized,false);
  for(const x of [none,withGps])assert.ok(Object.values(x.checks).every(Boolean));
 }finally{rmSync(d,{recursive:true,force:true})}
});
