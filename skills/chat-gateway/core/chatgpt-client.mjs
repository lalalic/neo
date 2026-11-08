/** Submit owner messages through Neo.app's existing authenticated ChatGPT tool.
 * The receipt is QUEUE ACCEPTANCE, not a generated assistant response.
 */
export function createChatGPTSubmitter({ endpoint, fetcher = fetch, timeoutMs = 15000 }) {
  if (!/^http:\/\/127\.0\.0\.1:\d+\/mcp$/.test(endpoint)) {
    throw new Error('ChatGPT provider must be accessed via local Neo MCP');
  }
  return async function submit({ threadId, projectId, text }) {
    const response = await fetcher(endpoint, {
      method: 'POST',
      redirect: 'error',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: Date.now(), method: 'tools/call',
        params: { name: 'chatgpt', arguments: {
          command: 'turn', args: {
            thread_id: threadId,
            ...(projectId ? { project_id: projectId } : {}),
            message: text,
            mode: 'async',
            mergeable: false,
            reason: 'Neo Mobile Chat owner message',
          },
        } },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`Neo ChatGPT HTTP ${response.status}`);
    const contentType = response.headers?.get?.('content-type') ?? '';
    let body;
    if (contentType.includes('text/event-stream')) {
      const line = (await response.text()).split('\n').find((item) => item.startsWith('data:'));
      body = JSON.parse(line?.slice(5).trim() ?? '{}');
    } else {
      body = await response.json();
    }
    const result = body?.result;
    if (body?.error || result?.isError) throw new Error('Neo ChatGPT rejected the turn');
    const blocks = result?.content ?? [];
    const textBlock = blocks.find((block) => block?.type === 'text')?.text;
    const payload = result?.structuredContent ??
      (typeof textBlock === 'string' ? JSON.parse(textBlock) : {});
    const receipt = payload?.result ?? payload;
    if (receipt?.status !== 'submitted' || receipt?.mode !== 'new-turn') {
      throw new Error('ChatGPT did not confirm durable queue acceptance');
    }
    return { status: 'submitted', mode: 'new-turn' };
  };
}
