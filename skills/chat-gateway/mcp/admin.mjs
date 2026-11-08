/** Register only this service's known loopback MCP endpoint with Neo.app. */
export async function registerGateway({ endpoint, port, fetcher = fetch }) {
  if (!/^http:\/\/127\.0\.0\.1:\d+\/mcp$/.test(endpoint)) throw new Error('Neo MCP endpoint is not loopback');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid gateway port');
  const command = `mcp add chat-gateway http://127.0.0.1:${port}/mcp`;
  const response = await fetcher(endpoint, {
    method: 'POST', redirect: 'error',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'setup', arguments: { command } } }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`Neo MCP registration HTTP ${response.status}`);
  const reply = await response.json();
  const result = reply.result;
  if (reply.error || !result || result.isError) throw new Error('Neo MCP registration rejected');
  const text = result.content?.find((c) => c.type === 'text')?.text ?? '';
  if (/^Error:|^unknown command/i.test(text)) throw new Error(`Neo registration error: ${text.slice(0, 120)}`);
  return { registered: true, name: 'chat-gateway', endpoint: `http://127.0.0.1:${port}/mcp` };
}
