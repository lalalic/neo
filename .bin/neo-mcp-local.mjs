import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_DEPLOYMENT_FILE = join(homedir(), 'Library/Application Support/NeoY/deployment.json');
const DEFAULT_PORT = 6767;
const CALL_TIMEOUT_MS = 120_000;

// Only explicitly approved local Neo.app MCP tools are CLI-callable.
// Generic tools/list discovery must not grant access to setup/shell/cluster etc.
// The computer facade remains under its own subcommand whitelist.
const CLI_MCP_TOOLS = new Set(['markcut.preview']);

const COMPUTER_COMMANDS = new Set([
  'list_apps', 'get_app_state', 'click', 'drag', 'key', 'scroll',
  'type', 'select_text', 'set_value', 'perform_secondary_action',
]);

export function localMcpEndpoint({ deploymentFile = DEFAULT_DEPLOYMENT_FILE } = {}) {
  let port = DEFAULT_PORT;
  try {
    const config = JSON.parse(readFileSync(deploymentFile, 'utf8'));
    if (config.mcpPort !== undefined) port = config.mcpPort === 9224 ? DEFAULT_PORT : config.mcpPort;
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`Cannot load Neo.app MCP settings: ${error.message}`);
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Invalid Neo.app local MCP port');
  }
  return `http://127.0.0.1:${port}/mcp`;
}

export function readArgumentsFile(path) {
  if (!path || path.startsWith('-')) throw new Error('--args-file requires a file path');
  let args;
  try {
    args = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read --args-file JSON: ${error.message}`);
  }
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    throw new Error('--args-file must contain a JSON object');
  }
  return args;
}

function parseArgsFile(args) {
  if (!args.length) return {};
  if (args.length !== 2 || args[0] !== '--args-file') {
    throw new Error('Expected optional --args-file PATH');
  }
  return readArgumentsFile(args[1]);
}

function computerHelpOnly(result) {
  if (result.isError) return result;
  const content = result.content?.find(item => item?.type === 'text');
  let decoded;
  try {
    decoded = JSON.parse(content?.text);
  } catch {
    throw new Error('Neo.app Computer Use help returned invalid JSON');
  }
  if (!Array.isArray(decoded.commands)) {
    throw new Error('Neo.app Computer Use help has no commands');
  }
  return {
    ...result,
    content: [{
      type: 'text',
      text: JSON.stringify({
        commands: decoded.commands.filter(item => COMPUTER_COMMANDS.has(item.command)),
      }),
    }],
  };
}

/** Only allow the running Neo.app listener on loopback, never a discovered remote URI. */
async function localRpc(method, params, {
  fetcher=fetch, endpoint=localMcpEndpoint(), timeoutMs=CALL_TIMEOUT_MS,
}={}){
  if(!/^http:\/\/127\.0\.0\.1:\d+\/mcp$/.test(endpoint))
    throw new Error('Neo CLI MCP requires a local Neo.app listener');
  let response;
  try{
    response=await fetcher(endpoint,{
      method:'POST',redirect:'error',
      headers:{'content-type':'application/json',accept:'application/json'},
      body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),
      signal:AbortSignal.timeout(timeoutMs),
    });
  }catch(error){throw new Error(`Cannot reach local Neo.app MCP: ${error.message}`)}
  if(!response.ok)throw new Error(`Neo.app MCP returned HTTP ${response.status}`);
  let payload;
  try{payload=await response.json()}catch{throw new Error('Neo.app MCP returned invalid JSON')}
  if(payload?.error)throw new Error(`Neo.app MCP error ${payload.error.code}: ${payload.error.message}`);
  if(payload?.id!==1 || !payload.result || typeof payload.result!=='object')
    throw new Error('Neo.app MCP returned an invalid JSON-RPC result');
  return payload.result;
}

/** Live list; CLI exposure remains an explicit subset, not a permission bypass. */
export async function listLocalMcpTools(options={}){
 const result=await localRpc('tools/list',{},options);
 if(!Array.isArray(result.tools))throw Error('Neo.app MCP tools/list response lacks tools');
 return {tools:result.tools.filter(t=>CLI_MCP_TOOLS.has(t?.name))};
}

/** Invoke a permitted registered tool through Neo's own federated MCP endpoint. */
export async function callLocalMcpTool(name,args={},options={}){
 if(!CLI_MCP_TOOLS.has(name))throw Error(`Neo MCP CLI tool is not exposed: ${String(name)}`);
 if(!args || typeof args!=='object' || Array.isArray(args))throw Error('Neo MCP arguments must be a JSON object');
 if(name==='markcut.preview'){
  if(typeof args.path!=='string'||!args.path.startsWith('/')||!args.path.endsWith('.md'))
   throw Error('markcut.preview requires an absolute .md path');
  if(args.relay!==undefined && (!args.relay||typeof args.relay!=='object'||
    !String(args.relay.jobId||'')||!String(args.relay.taskId||'')||
    typeof args.relay.executionId!=='string'||!args.relay.executionId))
   throw Error('Managed markcut.preview requires relay.jobId, relay.taskId, and relay.executionId');
 }
 const inventory=await listLocalMcpTools(options);
 if(!inventory.tools.some(t=>t.name===name))throw Error(`Neo.app MCP tool not currently registered: ${name}`);
 return localRpc('tools/call',{name,arguments:args},options);
}

export async function runLocalMcpCli(argv,options={}){
 const [action,name,...args]=argv;
 if(action==='tools'&&name===undefined)return listLocalMcpTools(options);
 if(action!=='call'||!name||name.startsWith('-'))
  throw Error('Usage: neo mcp tools | neo mcp call markcut.preview --args-file PATH');
 if(args.length!==2||args[0]!=='--args-file')
  throw Error('neo mcp call requires --args-file PATH');
 return callLocalMcpTool(name,readArgumentsFile(args[1]),options);
}

/** Computer Use retains its fine-grained subcommand whitelist. */
export async function callLocalComputer(command, args = {}, {
  fetcher = fetch, endpoint = localMcpEndpoint(), timeoutMs = CALL_TIMEOUT_MS,
} = {}) {
  if (command !== 'help' && !COMPUTER_COMMANDS.has(command)) {
    throw new Error(`Computer Use command is not allowed: ${String(command)}`);
  }
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    throw new Error('Computer Use arguments must be a JSON object');
  }
  // Never follow redirects or use remote MCP endpoints.
  if (!/^http:\/\/127\.0\.0\.1:\d+\/mcp$/.test(endpoint)) {
    throw new Error('Neo CLI Computer Use requires a local Neo.app listener');
  }
  let response;
  try {
    response = await fetcher(endpoint, {
      method: 'POST', redirect: 'error',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name: 'computer', arguments: { command, ...(command === 'help' ? {} : { args }) } },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new Error(`Cannot reach local Neo.app Computer Use: ${error.message}`);
  }
  if (!response.ok) throw new Error(`Neo.app MCP returned HTTP ${response.status}`);
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error('Neo.app MCP returned invalid JSON');
  }
  if (payload?.error) {
    throw new Error(`Neo.app MCP error ${payload.error.code}: ${payload.error.message}`);
  }
  if (payload?.id !== 1 || !payload.result || typeof payload.result !== 'object') {
    throw new Error('Neo.app MCP returned an invalid JSON-RPC result');
  }
  return command === 'help' ? computerHelpOnly(payload.result) : payload.result;
}

export async function runComputerUseCli(argv, options = {}) {
  const [operation, command, ...args] = argv;
  if (operation === 'help' && command === undefined) {
    return callLocalComputer('help', {}, options);
  }
  if (operation !== 'call' || !command || command.startsWith('-')) {
    throw new Error('Usage: neo computer-use help | neo computer-use call COMMAND [--args-file PATH]');
  }
  if (!COMPUTER_COMMANDS.has(command)) {
    throw new Error(`Computer Use command is not allowed: ${command}`);
  }
  return callLocalComputer(command, parseArgsFile(args), options);
}
