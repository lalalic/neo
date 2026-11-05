import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_DEPLOYMENT_FILE = join(homedir(), 'Library/Application Support/NeoY/deployment.json');
const DEFAULT_PORT = 6767;
const CALL_TIMEOUT_MS = 120_000;

/** Use Neo.app's local listener; no external MCP credentials or remote endpoint. */
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

export async function localMcpRequest(method, params = {}, {
  fetcher = fetch, endpoint = localMcpEndpoint(), timeoutMs = CALL_TIMEOUT_MS,
} = {}) {
  // Never follow a redirect or use an externally supplied remote MCP endpoint.
  if (!/^http:\/\/127\.0\.0\.1:\d+\/mcp$/.test(endpoint)) {
    throw new Error('Neo CLI MCP transport requires a local Neo.app listener');
  }
  let response;
  try {
    response = await fetcher(endpoint, {
      method: 'POST', redirect: 'error',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new Error(`Cannot reach local Neo.app MCP: ${error.message}`);
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
  return payload.result;
}

export async function runLocalMcpCli(argv, options = {}) {
  const [command, ...args] = argv;
  if (command === 'tools' && args.length === 0) {
    return localMcpRequest('tools/list', {}, options);
  }
  if (command === 'call') {
    const [tool, ...optionsArgs] = args;
    if (!tool || tool.startsWith('-')) throw new Error('Usage: neo mcp call TOOL [--args-file PATH]');
    return localMcpRequest('tools/call', { name: tool, arguments: parseArgsFile(optionsArgs) }, options);
  }
  throw new Error('Usage: neo mcp tools | neo mcp call TOOL [--args-file PATH]');
}

export async function runComputerUseCli(argv, options = {}) {
  const [operation, command, ...args] = argv;
  if (operation === 'help' && command === undefined) {
    return localMcpRequest('tools/call', { name: 'computer', arguments: { command: 'help' } }, options);
  }
  if (operation !== 'call' || !command || command.startsWith('-')) {
    throw new Error('Usage: neo computer-use help | neo computer-use call COMMAND [--args-file PATH]');
  }
  return localMcpRequest('tools/call', {
    name: 'computer', arguments: { command, args: parseArgsFile(args) },
  }, options);
}
