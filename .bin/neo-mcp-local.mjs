import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_DEPLOYMENT_FILE = join(homedir(), 'Library/Application Support/NeoY/deployment.json');
const DEFAULT_PORT = 6767;
const CALL_TIMEOUT_MS = 120_000;

// This is the sole Neo.app tool exposed through Neo CLI. Shell and WebHelm
// are local skills/CLIs, not arbitrary Neo.app MCP tools.
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

/** The only Neo.app call permitted by this module is its Computer Use facade. */
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
