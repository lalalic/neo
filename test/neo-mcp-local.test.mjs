import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  localMcpEndpoint, readArgumentsFile, callLocalComputer, runComputerUseCli,
  listLocalMcpTools, callLocalMcpTool, runLocalMcpCli,
} from '../.bin/neo-mcp-local.mjs';

const dir = mkdtempSync(join(tmpdir(), 'neo-mcp-local-'));
function file(name, content) {
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}
function mock(responseData, status = 200) {
  const calls = [];
  return {
    calls,
    fetcher: async (url, init) => {
      calls.push({ url, init, body: JSON.parse(init.body) });
      return Response.json(responseData, { status });
    },
  };
}
const endpoint = 'http://127.0.0.1:6767/mcp';

test('local endpoint uses configured Neo.app loopback port, never a remote host', () => {
  assert.equal(localMcpEndpoint({ deploymentFile: join(dir, 'nonexistent.json') }), endpoint);
  assert.equal(localMcpEndpoint({ deploymentFile: file('settings.json', '{"mcpPort":7007}') }), 'http://127.0.0.1:7007/mcp');
  assert.equal(localMcpEndpoint({ deploymentFile: file('legacy.json', '{"mcpPort":9224}') }), endpoint);
  assert.throws(() => localMcpEndpoint({ deploymentFile: file('bad.json', '{"mcpPort":"example.com"}') }), /Invalid/);
  assert.throws(() => localMcpEndpoint({ deploymentFile: file('bad-json.json', '{') }), /Cannot load/);
});

test('arguments are read as a JSON object file, not CLI inline text', () => {
  assert.deepEqual(readArgumentsFile(file('params.json', '{"app":"Finder"}')), {app:'Finder'});
  assert.throws(() => readArgumentsFile(file('params-array.json', '[]')), /JSON object/);
  assert.throws(() => readArgumentsFile(file('params-malformed.json', '{')), /Cannot read/);
  assert.throws(() => readArgumentsFile('-'), /requires a file path/);
});

test('Computer Use always calls only the computer facade through loopback, with no secret header', async () => {
  const m = mock({jsonrpc:'2.0', id:1, result:{content:[{type:'text',text:'{"apps":[]}'}], isError:false}});
  await runComputerUseCli(['call','list_apps'], {fetcher:m.fetcher,endpoint});
  const [{url, init, body}] = m.calls;
  assert.equal(url, endpoint);
  assert.equal(init.redirect, 'error');
  assert.equal(init.headers.authorization, undefined);
  assert.equal(body.method, 'tools/call');
  assert.deepEqual(body.params, {name:'computer',arguments:{command:'list_apps',args:{}}});
  await assert.rejects(callLocalComputer('list_apps', {}, {fetcher:m.fetcher,endpoint:'https://example.com/mcp'}), /local Neo.app listener/);
  assert.equal(m.calls.length, 1);
});

test('Computer Use forwards arguments and full result, including errors', async () => {
  const m = mock({jsonrpc:'2.0', id:1, result:{content:[{type:'text',text:'snapshot'}], isError:false}});
  const result = await runComputerUseCli(['call','get_app_state','--args-file',file('finder.json','{"app":"Finder"}')], {fetcher:m.fetcher,endpoint});
  assert.deepEqual(result, {content:[{type:'text',text:'snapshot'}], isError:false});
  assert.deepEqual(m.calls[0].body.params, {name:'computer',arguments:{command:'get_app_state',args:{app:'Finder'}}});
});

test('Computer Use help only lists locally allowlisted commands', async () => {
  const upstream = JSON.stringify({commands:[
    {command:'click',description:'click'},
    {command:'list_apps',description:'list'},
    {command:'unsafe_future_tool',description:'do something else'},
    {command:'shell',description:'run commands'}
  ]});
  const m = mock({jsonrpc:'2.0', id:1, result:{content:[{type:'text',text:upstream}], isError:false}});
  const result = await runComputerUseCli(['help'], {fetcher:m.fetcher,endpoint});
  const commands = JSON.parse(result.content[0].text).commands.map(item=>item.command);
  assert.deepEqual(commands, ['click','list_apps']);
  assert.deepEqual(m.calls[0].body.params, {name:'computer',arguments:{command:'help'}});
});

test('future and unrelated computer subcommands are rejected before any MCP call', async () => {
  const m = mock({jsonrpc:'2.0',id:1,result:{}});
  for (const operation of ['shell','setup','help','unknown','__proto__']) {
    await assert.rejects(runComputerUseCli(['call',operation], {fetcher:m.fetcher,endpoint}), /not allowed/);
  }
  await assert.rejects(callLocalComputer('shell',{}, {fetcher:m.fetcher,endpoint}), /not allowed/);
  await assert.rejects(runComputerUseCli(['call'], {fetcher:m.fetcher,endpoint}), /Usage/);
  await assert.rejects(runComputerUseCli(['call','click','--wrong','f'], {fetcher:m.fetcher,endpoint}), /--args-file/);
  assert.equal(m.calls.length, 0);
});

test('invalid help format fails closed', async () => {
  const m = mock({jsonrpc:'2.0',id:1,result:{content:[{type:'text',text:'invalid'}],isError:false}});
  await assert.rejects(runComputerUseCli(['help'], {fetcher:m.fetcher,endpoint}), /help returned invalid JSON/);
});

test('MCP network, HTTP, and JSON-RPC errors are surfaced', async () => {
  const http = mock({error:'denied'}, 403);
  await assert.rejects(callLocalComputer('list_apps',{}, {fetcher:http.fetcher,endpoint}), /HTTP 403/);
  const rpc = mock({jsonrpc:'2.0', id:1, error:{code:-32003,message:'Feature is disabled'}});
  await assert.rejects(callLocalComputer('list_apps',{}, {fetcher:rpc.fetcher,endpoint}), /Feature is disabled/);
  const malformed = mock({jsonrpc:'2.0',id:5,result:{}});
  await assert.rejects(callLocalComputer('list_apps',{}, {fetcher:malformed.fetcher,endpoint}), /invalid JSON-RPC/);
  await assert.rejects(callLocalComputer('list_apps',{}, {fetcher:async()=>{throw new Error('offline')},endpoint}), /offline/);
});

test('tool-level isError remains visible to nonzero-exit CLI wrapper', async () => {
  const m = mock({jsonrpc:'2.0',id:1,result:{isError:true,content:[{type:'text',text:'operation denied'}]}});
  const result = await runComputerUseCli(['call','click'], {fetcher:m.fetcher,endpoint});
  assert.equal(result.isError, true);
  assert.equal(result.content[0].text, 'operation denied');
});

test('Neo CLI exposes only registered preview tool and does not unlock privileged MCP tools', async()=>{
 const calls=[];
 const fetcher=async(_url,init)=>{
  const body=JSON.parse(init.body);calls.push({body,init});
  if(body.method==='tools/list')return Response.json({jsonrpc:'2.0',id:1,result:{tools:[
   {name:'markcut.preview',description:'Video preview',inputSchema:{type:'object'}},
   {name:'computer',description:'macOS actions'},
   {name:'shell',description:'system shell'},
   {name:'setup',description:'Neo admin'},
  ]}});
  if(body.method==='tools/call')return Response.json({jsonrpc:'2.0',id:1,result:{isError:false,
   structuredContent:{operationId:'f'.repeat(32),status:'pending'}}});
  throw Error('unexpected method');
 };
 const options={fetcher,endpoint};
 const inventory=await listLocalMcpTools(options);
 assert.deepEqual(inventory.tools.map(x=>x.name),['markcut.preview']);
 assert.deepEqual((await runLocalMcpCli(['tools'],options)).tools.map(x=>x.name),['markcut.preview']);
 const params={path:'/private/runs/2026-11-09/visioner-review.md',relay:{jobId:'583',taskId:'content-run',executionId:'run-execution-id'}};
 const result=await runLocalMcpCli(['call','markcut.preview','--args-file',file('preview.json',JSON.stringify(params))],options);
 assert.equal(result.isError,false);
 assert.equal(calls.at(-1).body.method,'tools/call');
 assert.deepEqual(calls.at(-1).body.params,{name:'markcut.preview',arguments:params});
 assert.equal(calls.at(-1).init.redirect,'error');
 assert.equal(calls.at(-1).init.headers.authorization,undefined);
 for(const name of ['computer','setup','shell','cluster','mcp.markcut','markcut.preview.submit','__proto__'])
  await assert.rejects(callLocalMcpTool(name,params,options),/not exposed/);
 assert.equal(calls.filter(x=>x.body.method==='tools/call').length,1);
});

test('Neo preview refuses invalid arguments and unregistered providers',async()=>{
 const options={endpoint,fetcher:async()=>Response.json({jsonrpc:'2.0',id:1,result:{tools:[]}})};
 await assert.rejects(callLocalMcpTool('markcut.preview',{path:'relative.md'},options),/absolute/);
 await assert.rejects(callLocalMcpTool('markcut.preview',{path:'/private/video.md',relay:{jobId:'583',taskId:'content-run'}},options),/executionId/);
 await assert.rejects(callLocalMcpTool('markcut.preview',{path:'/private/video.md'},options),/not currently registered/);
 await assert.rejects(runLocalMcpCli(['call','markcut.preview'],options),/args-file/);
 await assert.rejects(runLocalMcpCli(['call','setup','--args-file',file('setup.json','{}')],options),/not exposed/);
 await assert.rejects(runLocalMcpCli(['call','markcut.preview','--wrong','/tmp/f.json'],options),/args-file/);
 await assert.rejects(callLocalMcpTool('markcut.preview',{path:'/tmp/file.md'},{endpoint:'https://example.com/mcp',fetcher:options.fetcher}),/local Neo.app listener/);
});

test('Neo CLI help shows approved local MCP preview access without unrestricted tool calls',()=>{
 const cli=resolve('.bin/neo.mjs');
 const help=execFileSync(process.execPath,[cli,'--help'],{encoding:'utf8'});
 assert.match(help,/neo mcp tools/);
 assert.match(help,/neo mcp call markcut.preview/);
 assert.match(help,/neo computer-use help/);
 for(const args of [['mcp','call','setup','--args-file',file('deny.json','{}')],['computer-use','call','shell']])
  assert.throws(()=>execFileSync(process.execPath,[cli,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}),{status:1});
});
