#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expandPublishEvent } from '../core/publish-envelope.mjs';
import { normalizePublishEvent } from '../core/events-core.mjs';

const [,,type,dataJson='{}']=process.argv;
if (!type) { console.error('usage: emit.mjs <type> [data-json]'); process.exit(2); }
const source=process.env.NEO_EVENT_SOURCE;
if (!source) { console.error('NEO_EVENT_SOURCE is required'); process.exit(2); }
let event;
try {
  event=normalizePublishEvent(expandPublishEvent({type,source,data:JSON.parse(dataJson)})).event;
} catch(error) { console.error(error.message); process.exit(2); }
const subject=`neo.events.job.${event.job_id}.${event.type}`;
const transport=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../transport/nats.mjs');
const result=spawnSync(process.execPath,[transport,'pub',subject,JSON.stringify(event)],{encoding:'utf8',env:process.env});
if(result.status!==0){process.stderr.write(JSON.stringify(event)+'\n');if(result.stderr)process.stderr.write(result.stderr);process.exit(result.status??1);}
process.stdout.write(JSON.stringify(event)+'\n');
