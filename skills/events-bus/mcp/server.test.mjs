import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('MCP exposes six tools and no obsolete progress resource', () => {
  const requests = [
    {jsonrpc:'2.0',id:1,method:'tools/list'},
    {jsonrpc:'2.0',id:2,method:'resources/list'},
    {jsonrpc:'2.0',id:3,method:'resources/read',params:{uri:'ui://events-bus/job-progress-v1.html'}},
    {jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'progress',arguments:{job_id:'test'}}},
  ];
  const result = spawnSync(process.execPath, [new URL('./server.mjs', import.meta.url).pathname], {
    input: requests.map(x=>JSON.stringify(x)).join('\n')+'\n',encoding:'utf8',timeout:10000,
  });
  assert.equal(result.status,0,result.stderr);
  const responses = new Map(result.stdout.trim().split('\n').map(line=>{const x=JSON.parse(line);return [x.id,x];}));
  assert.deepEqual(responses.get(1).result.tools.map(x=>x.name).sort(), ['health','history','publish','status','wait','watch']);
  assert.deepEqual(responses.get(2).result.resources,[]);
  assert.equal(responses.get(3).error.code,-32602);
  assert.equal(responses.get(4).result.isError,true);
});
