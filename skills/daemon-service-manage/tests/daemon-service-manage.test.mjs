import test from 'node:test';
import assert from 'node:assert/strict';
import {serviceId,parse,pm2Arguments,main} from '../bin/serviceman.mjs';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

test('namespaced service ID enforced', () => {
  assert.equal(serviceId('events-bus','history'),'events-bus/history');
  for (const [skill,service] of [['events-bus','../bad'],['Bad','history'],['webhelm','x/y'],['','service']]) assert.throws(()=>serviceId(skill,service));
});
test('define always constructs namespaced PM2 name',()=>{
 const x=parse(['define','--skill','webhelm','--service','daemon','--','uvx','webhelm','serve']);
 assert.deepEqual(pm2Arguments(x),['start','uvx','--name','webhelm/daemon','--','webhelm','serve']);
});
test('mutations dry run unless --apply',()=>{
 let called=false, out=''; const code=main(['restart','--skill','events-bus','--service','history'],()=>{called=true;return {status:0}},x=>{out=x});
 assert.equal(code,0);assert.equal(called,false);assert.match(out,/events-bus\/history/);
});
test('rejects malformed and foreign command args',()=>{
 assert.throws(()=>parse(['define','--skill','events-bus','--service','history']));
 assert.throws(()=>parse(['status','--skill','events-bus','--service','history','--','rm']));
});

test('define is idempotent when registered and does not restart running process',()=>{
  const calls=[];const spawn=(cmd,args)=>{calls.push(args);return {status:0,stdout:JSON.stringify([{name:'events-bus/history',pm2_env:{status:'online'}}])}};
  let message=''; assert.equal(main(['define','--skill','events-bus','--service','history','--apply','--','node','server.mjs'],spawn,x=>message=x),0);
  assert.equal(calls.length,1); assert.match(message,/"changed":false/);
});

test('symlinked serviceman actually executes its main entrypoint',()=>{
  const dir=mkdtempSync(join(tmpdir(),'neo-serviceman-test-'));
  const link=join(dir,'serviceman');
  try {
    symlinkSync(resolve('skills/daemon-service-manage/bin/serviceman.mjs'),link);
    const direct=spawnSync(process.execPath,[resolve('skills/daemon-service-manage/bin/serviceman.mjs'),'invalid'],{encoding:'utf8'});
    const linked=spawnSync(link,['invalid'],{encoding:'utf8'});
    assert.equal(direct.status,2);
    assert.equal(linked.status,2);
    assert.match(linked.stderr,/usage: serviceman/);
  } finally {
    rmSync(dir,{recursive:true,force:true});
  }
});
