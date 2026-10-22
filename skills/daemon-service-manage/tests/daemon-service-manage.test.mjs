import test from 'node:test';
import assert from 'node:assert/strict';
import {serviceId,parse,pm2Arguments,main} from '../bin/daemon-service-manage.mjs';
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
