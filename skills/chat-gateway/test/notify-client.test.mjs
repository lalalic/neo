import test from 'node:test';
import assert from 'node:assert/strict';
import { createNeoNotifier } from '../core/notify.mjs';
import { registerGateway } from '../mcp/admin.mjs';

test('Neo notifier performs a loopback setup JSON-RPC call and acknowledges only clean results', async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return Response.json({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'forwarded' }] } });
  };
  const notifier = createNeoNotifier({ endpoint: 'http://127.0.0.1:6767/mcp', fetcher });
  const ack = await notifier.send({ kind: 'completed', title: 'Hello', body: 'job 1', idempotencyKey: 'key1' });
  assert.equal(ack.ok, true);
  assert.ok(ack.deliveryId);
  assert.equal(calls[0].body.params.name, 'setup');
  assert.match(calls[0].body.params.arguments.command, /^events notify completed/);
  assert.throws(() => createNeoNotifier({ endpoint: 'http://example.com/mcp' }));
});

test('Neo notifier RPC errors are never treated as delivery acknowledgements', async () => {
  const fetcher = async () => Response.json({ jsonrpc: '2.0', id: 1,
    result: { isError: true, content: [{ type: 'text', text: 'unavailable' }] } });
  const notifier = createNeoNotifier({ endpoint: 'http://127.0.0.1:6767/mcp', fetcher });
  await assert.rejects(notifier.send({ kind: 'completed', title: 'job', body: 'id' }), /unavailable/);
});

test('federation registration authorizes only this provider via Neo applied settings', async () => {
  const commands = [];
  const registered = await registerGateway({
    endpoint: 'http://127.0.0.1:6767/mcp', port: 8791,
    fetcher: async (_url, init) => {
      const command = JSON.parse(init.body).params.arguments.command;
      commands.push(command);
      const receipt = command.startsWith('mcp add')
        ? { configuration: { mcp_servers: [{ name: 'chat-gateway' }] }, ok: true }
        : { ok: true, operation: 'deployment.provider' };
      return Response.json({ jsonrpc: '2.0', id: 1,
        result: { content: [{ type: 'text', text: JSON.stringify(receipt) }] } });
    },
  });
  assert.equal(registered.registered, true);
  assert.equal(registered.remotelyExposed, true);
  assert.deepEqual(commands, [
    'mcp add chat-gateway http://127.0.0.1:8791/mcp',
    'deployment provider enable chat-gateway',
  ]);
});

test('never claims remote exposure if Neo rejects provider grant', async () => {
  let index = 0;
  await assert.rejects(registerGateway({
    endpoint: 'http://127.0.0.1:6767/mcp', port: 8791,
    fetcher: async () => Response.json({
      result: { content: [{ type: 'text', text: JSON.stringify(index++ === 0
        ? { ok: true } : { ok: false, error: 'rejected' }) }] },
    }),
  }), /did not acknowledge/);
});
