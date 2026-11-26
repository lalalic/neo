#!/usr/bin/env node
import http from 'node:http';
import { createEventsBusCore } from '../core/events-core.mjs';
import { resolveRuntimeConfig, writeRuntimeConfig } from '../core/config.mjs';

const core = createEventsBusCore({ config:resolveRuntimeConfig(), name: 'events-bus-api', recordNats: true });
const config=core.config;
writeRuntimeConfig(config);
await core.startRecorder();

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
}
function int(value) { if(!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value)))throw Error('invalid integer query parameter');return Number(value); }

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${config.apiHost}:${config.apiPort}`);
  try {
    if (req.method === 'GET' && url.pathname === '/config') return json(res, 200, { natsUrl: config.natsUrl, apiUrl: config.apiUrl, dataDir: config.dataDir, subjectPrefix: config.subjectPrefix });
    if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, await core.health());
    if (req.method === 'GET') {
      if(url.pathname==='/events'){
        const q=url.searchParams;
        const allowed=new Set(["source","sourcePrefix","type","subject","filter","after","limit","order"]);
        for(const k of q.keys())if(!allowed.has(k)||q.getAll(k).length!==1)throw Error("unknown or duplicate history query parameter: "+k);
        return json(res,200,core.query({source:q.get('source')??undefined,sourcePrefix:q.get('sourcePrefix')??undefined,type:q.get('type')??undefined,subject:q.get('subject')??undefined,filter:q.has('filter')?JSON.parse(q.get('filter')):undefined,after:int(q.get('after')??'0'),limit:int(q.get('limit')??'100'),order:q.get('order')||'asc'}));
      }
    }
    if (req.method === 'POST' && url.pathname === '/events') {
      const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>1024*1024)throw Error('event exceeds size limit');chunks.push(c)}
      const body=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');
      if(!body||typeof body!=='object'||Array.isArray(body))throw Error('event must be an object');
      const {event_id,...event}=body;
      return json(res,200,await core.publish(event,{eventId:event_id}));
    }
    json(res, 404, { error:'not_found' });
  } catch (error) { json(res, 400, { error: error?.message || String(error) }); }
});
server.listen(config.apiPort, config.apiHost, () => process.stderr.write(`events-bus api ${config.apiUrl}\n`));
async function shutdown() { server.close(); await core.close(); process.exit(0); }
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
