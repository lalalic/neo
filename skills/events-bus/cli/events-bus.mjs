#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEventsBusCore } from '../core/events-core.mjs';
import { expandPublishEvent } from '../core/publish-envelope.mjs';
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
    if (!raw) throw new Error('publish requires --file PATH or JSON argument with type/source/data'); print(await core.publish(expandPublishEvent(JSON.parse(raw)),{agent:'cli'}));
  } else if (command==='setup') {
    writeRuntimeConfig(config);
    const here=path.dirname(fileURLToPath(import.meta.url)); const api=path.resolve(here,'../api/server.mjs');
    const natsBin=arg('--nats-bin', process.env.NATS_SERVER_BIN || '/opt/homebrew/opt/nats-server/bin/nats-server');
    if (!fs.existsSync(natsBin)) throw new Error(`nats-server not found: ${natsBin}`);
    const serviceManager = process.env.SERVICEMAN_BIN || 'serviceman';
    const define = (service, executable, args) => {
      const result = spawnSync(serviceManager, ['define','--skill','events-bus','--service',service,'--apply','--',executable,...args], {stdio:'inherit'});
      if (result.error) throw result.error;
      if (result.status !== 0) throw new Error(`failed to register events-bus/${service}`);
    };
    define('nats', natsBin, ['-a','127.0.0.1','-p',new URL(config.natsUrl).port || '4222']);
    define('history', process.execPath, [api]);
    const status = await core.health();
    if (!status) throw new Error('events-bus health check returned no result');
    print({ok:true,configPath:writeRuntimeConfig(config),config});
  } else throw new Error(`unknown command: ${command}`);
} finally { await core.close(); }
