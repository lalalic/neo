/** Register a loopback provider AND grant only this provider remote exposure.
 * Uses NeoY's documented applied-deployment command, not a direct edit of its
 * private deployment.json, pending Remote UI draft, or general all-tools grant.
 */
export async function registerGateway({ endpoint, port, fetcher = fetch }) {
  if (!/^http:\/\/127\.0\.0\.1:\d+\/mcp$/.test(endpoint)) throw new Error('Neo MCP endpoint is not loopback');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid gateway port');

  async function setup(command) {
    const response = await fetcher(endpoint, {
      method: 'POST', redirect: 'error',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name: 'setup', arguments: { command } },
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error(`Neo MCP setup HTTP ${response.status}`);
    const reply = await response.json();
    const result = reply.result;
    if (reply.error || !result || result.isError) throw new Error('Neo MCP setup rejected');
    const text = result.content?.find((c) => c.type === 'text')?.text ?? '';
    if (/^Error:|^unknown command/i.test(text)) throw new Error('Neo setup command rejected');
    let receipt;
    try { receipt = JSON.parse(text); } catch { throw new Error('Neo setup returned no JSON receipt'); }
    if (receipt?.ok !== true && receipt?.configuration === undefined) {
      throw new Error('Neo setup did not acknowledge provider configuration');
    }
  }

  await setup(`mcp add chat-gateway http://127.0.0.1:${port}/mcp`);
  await setup('deployment provider enable chat-gateway');
  return {
    registered: true, remotelyExposed: true, name: 'chat-gateway',
    endpoint: `http://127.0.0.1:${port}/mcp`,
  };
}
