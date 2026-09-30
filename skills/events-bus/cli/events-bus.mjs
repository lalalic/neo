#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEventsBusCore } from '../core/events-core.mjs';
import { resolveRuntimeConfig, writeRuntimeConfig } from '../core/config.mjs';

const [,,command,...rest]=process.argv;
const config=resolveRuntimeConfig();
const core=createEventsBusCore({config,name:'events-bus-cli'});
const arg=(name, fallback=null)=>{const i=rest.indexOf(name); return i>=0 ? rest[i+1] : fallback;};
const num=(name,fallback)=>Number(arg(name,fallback));
const print=v=>process.stdout.write(`${JSON.stringify(v,null,2)}\n`);
try {
  if (!command || command==='help' || command==='--help') {
    process.stdout.write('events-bus config|health|publish|watch|wait|history|status|setup\n');
  } else if (command==='config') print(config);
  else if (command==='health') print(await core.health());
  else if (command==='history') print(core.history(arg('--job',''),num('--after',0),num('--limit',100),arg('--task')));
  else if (command==='watch') print(await core.watch(arg('--job','')));
  else if (command==='wait') print(await core.wait(arg('--job',''),num('--after',0),num('--timeout',25000),num('--limit',100)));
  else if (command==='status') print(core.status(arg('--job','')));
  else if (command==='publish') {
    const file=arg('--file'); const raw=file ? fs.readFileSync(file,'utf8') : rest.filter(x=>!x.startsWith('--') && x!==file)[0];
    if (!raw) throw new Error('publish requires --file PATH or JSON argument'); print(await core.publish(JSON.parse(raw),{agent:'cli'}));
  } else if (command==='setup') {
    writeRuntimeConfig(config);
    const here=path.dirname(fileURLToPath(import.meta.url)); const api=path.resolve(here,'../api/server.mjs');
    const natsBin=arg('--nats-bin', process.env.NATS_SERVER_BIN || '/opt/homebrew/opt/nats-server/bin/nats-server');
    if (!fs.existsSync(natsBin)) throw new Error(`nats-server not found: ${natsBin}`);
    const exists = (name) => spawnSync('npx',['pm2','describe',name],{stdio:'ignore'}).status === 0;
    if (!exists('events-bus')) {
      const nats=spawnSync('npx',['pm2','start',natsBin,'--name','events-bus','--','-a','127.0.0.1','-p',new URL(config.natsUrl).port||'4222'],{stdio:'inherit'});
      if (nats.status!==0) throw new Error('failed to start NATS');
    }
    const svcArgs = exists('events-bus-service') ? ['pm2','restart','events-bus-service','--update-env'] : ['pm2','start',api,'--name','events-bus-service','--interpreter','node'];
    const svc=spawnSync('npx',svcArgs,{stdio:'inherit'});
    if (svc.status!==0) throw new Error('failed to start events-bus-service');
    print({ok:true,configPath:writeRuntimeConfig(config),config});
  } else throw new Error(`unknown command: ${command}`);
} finally { await core.close(); }
