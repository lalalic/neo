import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  localMcpEndpoint, readArgumentsFile, localMcpRequest, runLocalMcpCli, runComputerUseCli,
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

test('local endpoint reads configured Neo.app port without allowing a remote host', () => {
  assert.equal(localMcpEndpoint({ deploymentFile: join(dir, 'nonexistent.json') }), endpoint);
  assert.equal(localMcpEndpoint({ deploymentFile: file('settings.json', '{"mcpPort":7007}') }), 'http://127.0.0.1:7007/mcp');
  assert.equal(localMcpEndpoint({ deploymentFile: file('legacy.json', '{"mcpPort":9224}') }), endpoint);
  assert.throws(() => localMcpEndpoint({ deploymentFile: file('bad.json', '{"mcpPort":"example.com"}') }), /Invalid/);
  assert.throws(() => localMcpEndpoint({ deploymentFile: file('bad-json.json', '{') }), /Cannot load/);
});

test('arguments must come from a JSON object file', () => {
  assert.deepEqual(readArgumentsFile(file('params.json', '{"app":"Finder"}')), {app:'Finder'});
  assert.throws(() => readArgumentsFile(file('params-array.json', '[]')), /JSON object/);
  assert.throws(() => readArgumentsFile(file('params-malformed.json', '{')), /Cannot read/);
  assert.throws(() => readArgumentsFile('-'), /requires a file path/);
});

test('tools/list uses authenticated local transport boundary without leaking credentials', async () => {
  const m = mock({ jsonrpc:'2.0', id:1, result:{ tools:[{name:'computer'}] } });
  assert.deepEqual(await runLocalMcpCli(['tools'], {fetcher:m.fetcher, endpoint}), {tools:[{name:'computer'}]});
  const [{url, init, body}] = m.calls;
  assert.equal(url, endpoint);
  assert.equal(init.redirect, 'error');
  assert.equal(init.headers.authorization, undefined);
  assert.equal(body.method, 'tools/list');
  assert.deepEqual(body.params, {});
  await assert.rejects(localMcpRequest('tools/list', {}, {fetcher:m.fetcher, endpoint:'https://example.com/mcp'}), /local Neo.app listener/);
});

test('generic MCP call sends tool and file arguments unchanged', async () => {
  const m = mock({jsonrpc:'2.0', id:1, result:{content:[{type:'text',text:'ok'}], isError:false}});
  const result = await runLocalMcpCli(['call','shell','--args-file',file('shell.json','{"command":"help"}')], {fetcher:m.fetcher,endpoint});
  assert.equal(result.content[0].text, 'ok');
  assert.deepEqual(m.calls[0].body.params, {name:'shell',arguments:{command:'help'}});
});

test('computer-use calls Neo.app facade and passes subcommand args', async () => {
  const m = mock({jsonrpc:'2.0', id:1, result:{content:[{type:'text',text:'{}'}],isError:false}});
  await runComputerUseCli(['help'], {fetcher:m.fetcher,endpoint});
  assert.deepEqual(m.calls[0].body.params, {name:'computer',arguments:{command:'help'}});
  await runComputerUseCli(['call','get_app_state','--args-file',file('finder.json','{"app":"Finder"}')], {fetcher:m.fetcher,endpoint});
  assert.deepEqual(m.calls[1].body.params, {name:'computer',arguments:{command:'get_app_state',args:{app:'Finder'}}});
  await runComputerUseCli(['call','list_apps'], {fetcher:m.fetcher,endpoint});
  assert.deepEqual(m.calls[2].body.params, {name:'computer',arguments:{command:'list_apps',args:{}}});
});

test('invalid CLI options fail before executing a tool', async () => {
  const m = mock({jsonrpc:'2.0',id:1,result:{}});
  await assert.rejects(runComputerUseCli(['call'], {fetcher:m.fetcher,endpoint}), /Usage/);
  await assert.rejects(runLocalMcpCli(['call','computer','--wrong','f'], {fetcher:m.fetcher,endpoint}), /--args-file/);
  await assert.rejects(runLocalMcpCli(['tools','unexpected'], {fetcher:m.fetcher,endpoint}), /Usage/);
  assert.equal(m.calls.length, 0);
});

test('MCP transport and JSON-RPC failures do not report success', async () => {
  const http = mock({error:'denied'}, 403);
  await assert.rejects(localMcpRequest('tools/list',{}, {fetcher:http.fetcher,endpoint}), /HTTP 403/);
  const rpc = mock({jsonrpc:'2.0', id:1, error:{code:-32003,message:'Feature is disabled'}});
  await assert.rejects(localMcpRequest('tools/call',{}, {fetcher:rpc.fetcher,endpoint}), /Feature is disabled/);
  const malformed = mock({jsonrpc:'2.0',id:5,result:{}});
  await assert.rejects(localMcpRequest('tools/list',{}, {fetcher:malformed.fetcher,endpoint}), /invalid JSON-RPC/);
  await assert.rejects(localMcpRequest('tools/list',{}, {fetcher:async()=>{throw new Error('offline')},endpoint}), /offline/);
});

test('tool-level isError is preserved for non-zero CLI exit', async () => {
  const m = mock({jsonrpc:'2.0',id:1,result:{isError:true,content:[{type:'text',text:'operation denied'}]}});
  const result = await runComputerUseCli(['call','click'], {fetcher:m.fetcher,endpoint});
  assert.equal(result.isError, true);
  assert.equal(result.content[0].text, 'operation denied');
});
