import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('MCP exposes publish only', () => {
  const requests = [
    {jsonrpc:'2.0',id:1,method:'tools/list'},
    {jsonrpc:'2.0',id:2,method:'resources/list'},
    {jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'history',arguments:{job_id:478}}},
  ];
  const result=spawnSync(process.execPath,[new URL('./server.mjs',import.meta.url).pathname],{
    input:requests.map(x=>JSON.stringify(x)).join('\n')+'\n',encoding:'utf8',timeout:10000
  });
  assert.equal(result.status,0,result.stderr);
  const rows=new Map(result.stdout.trim().split('\n').map(line=>{const x=JSON.parse(line);return [x.id,x]}));
  assert.deepEqual(rows.get(1).result.tools.map(x=>x.name),['publish']);
  assert.deepEqual(Object.keys(rows.get(1).result.tools[0].inputSchema.properties),['type','source','data']);
  assert.deepEqual(rows.get(2).result.resources,[]);
  assert.equal(rows.get(3).result.isError,true);
});
