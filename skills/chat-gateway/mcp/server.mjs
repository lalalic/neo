import http from 'node:http';

const MAX_BODY_BYTES = 64 * 1024;
const PROTOCOL_VERSION = '2025-03-26';
const HOST_PATTERN = /^(127\.0\.0\.1|localhost)(:\d+)?$/;
const ORIGIN_PATTERN = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;

const structured = (value, isError = false) => ({
  content: [{ type: 'text', text: JSON.stringify(value) }],
  structuredContent: value,
  ...(isError ? { isError: true } : {}),
});

function send(res, status, body, headers = {}) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('request too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * Minimal MCP server over HTTP (JSON-RPC, JSON responses) bound to loopback.
 * `onCall(name, args)` returns a plain object; thrown errors become tool errors.
 */
export function createMcpHttpServer({
  port, host = '127.0.0.1', tools, onCall, health = () => ({ status: 'ok' }), serverInfo = { name: 'chat-gateway', version: '0.1.2' },
}) {
  if (host !== '127.0.0.1') throw new Error('MCP server must bind to 127.0.0.1');
  const names = new Set(tools.map((tool) => tool.name));

  async function rpc(message) {
    const { id, method, params } = message;
    switch (method) {
      case 'initialize':
        return { jsonrpc: '2.0', id, result: {
          protocolVersion: typeof params?.protocolVersion === 'string' ? params.protocolVersion : PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo,
        } };
      case 'ping':
        return { jsonrpc: '2.0', id, result: {} };
      case 'tools/list':
        return { jsonrpc: '2.0', id, result: { tools } };
      case 'tools/call': {
        const name = params?.name;
        if (!names.has(name)) return { jsonrpc: '2.0', id, error: { code: -32602, message: 'Unknown tool' } };
        try {
          return { jsonrpc: '2.0', id, result: structured(await onCall(name, params?.arguments ?? {})) };
        } catch (error) {
          return { jsonrpc: '2.0', id, result: structured({ error: String(error?.message ?? error).slice(0, 300) }, true) };
        }
      }
      default:
        return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } };
    }
  }

  const server = http.createServer(async (req, res) => {
    try {
      if (!HOST_PATTERN.test(req.headers.host ?? '')) return send(res, 403, { error: 'forbidden host' });
      if (req.headers.origin && !ORIGIN_PATTERN.test(req.headers.origin)) return send(res, 403, { error: 'forbidden origin' });
      const path = new URL(req.url, 'http://localhost').pathname;
      if (req.method === 'GET' && path === '/health') return send(res, 200, await health());
      if (path !== '/mcp') return send(res, 404, { error: 'not found' });
      if (req.method !== 'POST') return send(res, 405, { error: 'POST only' }, { allow: 'POST' });
      let message;
      try {
        message = JSON.parse(await readBody(req));
      } catch (error) {
        if (error.status) return send(res, error.status, { error: error.message });
        return send(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      }
      if (!message || typeof message !== 'object' || Array.isArray(message) || typeof message.method !== 'string') {
        return send(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } });
      }
      if (message.id === undefined || message.id === null) {
        res.writeHead(202);
        return res.end();
      }
      return send(res, 200, await rpc(message));
    } catch (error) {
      return send(res, 500, { error: String(error?.message ?? error).slice(0, 200) });
    }
  });

  return {
    server,
    listen: () => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        server.off('error', reject);
        resolve(server.address().port);
      });
    }),
    close: () => new Promise((resolve) => {
      server.closeAllConnections?.();
      server.close(() => resolve());
    }),
  };
}
