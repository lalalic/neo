#!/usr/bin/env node
import http from 'node:http';
import { createEventsBusCore } from '../core/events-core.mjs';
import { resolveRuntimeConfig, writeRuntimeConfig } from '../core/config.mjs';

const config = resolveRuntimeConfig();
writeRuntimeConfig(config);
const core = createEventsBusCore({ config, name: 'events-bus-api', recordNats: true });
await core.startRecorder();

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
}
function int(value, fallback) { const n = Number(value); return Number.isFinite(n) ? Math.trunc(n) : fallback; }

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${config.apiHost}:${config.apiPort}`);
  try {
    if (req.method === 'GET' && url.pathname === '/config') return json(res, 200, { natsUrl: config.natsUrl, apiUrl: config.apiUrl, dataDir: config.dataDir, subjectPrefix: config.subjectPrefix });
    if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, await core.health());
    const job = url.searchParams.get('job') || '';
    if (req.method === 'GET' && url.pathname === '/events') return json(res, 200, core.history(job, int(url.searchParams.get('after'), 0), int(url.searchParams.get('limit'), 100), url.searchParams.get('task')));
    if (req.method === 'GET' && url.pathname === '/status') return json(res, 200, core.status(job));
    if (req.method === 'GET' && url.pathname === '/watch') return json(res, 200, await core.watch(job));
    if (req.method === 'GET' && url.pathname === '/wait') return json(res, 200, await core.wait(job, int(url.searchParams.get('after'), 0), int(url.searchParams.get('timeout'), 25000), int(url.searchParams.get('limit'), 100)));
    if (req.method === 'POST' && url.pathname === '/events') {
      const chunks=[]; for await (const c of req) chunks.push(c); const body=JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      return json(res, 200, await core.publish(body.event ?? body, { agent:'http-api' }));
    }
    json(res, 404, { error:'not_found' });
  } catch (error) { json(res, 400, { error: error?.message || String(error) }); }
});
server.listen(config.apiPort, config.apiHost, () => process.stderr.write(`events-bus api ${config.apiUrl}\n`));
async function shutdown() { server.close(); await core.close(); process.exit(0); }
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
