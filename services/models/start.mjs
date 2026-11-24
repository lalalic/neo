#!/usr/bin/env node
/** Common Neo authenticated model API. No project-specific agent instructions. */
import {readFileSync,statSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {createModelServer} from './server.mjs';
import {createModelReplyListener} from './reply-events.mjs';
import {createOrchestratorEventMonitor} from './orchestrator-events.mjs';
import {resolveConfig as resolveRelayEventConfig} from './core/config.mjs';
import {createNeoNotifier} from './core/notify.mjs';
import {resolveNeoMcpEndpoint} from './core/config.mjs';
const tokenFile=join(homedir(),'.config','neo','models','token');
if(statSync(tokenFile).mode&0o077)throw Error('model token file permissions must be 0600');
const token=readFileSync(tokenFile,'utf8').trim();
const port=Number(process.env.NEO_MODEL_GATEWAY_PORT??8769);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('invalid model gateway port');
const legacyOrigin=process.env.NEO_MODELS_LEGACY_ORIGIN??null;
if(legacyOrigin&&!/^http:\/\/127\.0\.0\.1:\d+$/.test(legacyOrigin))throw Error('legacy origin must be loopback');
const app=createModelServer({token,legacyOrigin,
  orchestratorNotifier:createNeoNotifier({endpoint:resolveNeoMcpEndpoint()})});
const {server,store}=app;
// The reply event listener is part of the model delivery contract; fail closed
// if Events Bus is unavailable rather than silently leaving requests pending.
const replyListener=process.env.NEO_MODEL_REPLY_EVENTS!=='0'?createModelReplyListener(store):null;
await replyListener?.start();
// Relay wakeups are opt-in and owned only by Models.
let relayMonitor=null;
if(process.env.NEO_ORCHESTRATOR_RELAY_EVENTS==='1'){
  try {
    relayMonitor=await createOrchestratorEventMonitor({
      orchestrator:app.orchestrator??app.getOrchestrator(),
      stateDir:join(store.base,'orchestrator-relay-events'),
      bootstrapWatchDir:join(store.base,'orchestrator-watch-bootstrap'),
      config:resolveRelayEventConfig(),
    });
    await relayMonitor.start(); // Fatal on missing baseline, no unsafe subscribe.
  } catch(error) {
    process.stderr.write('[models] Orchestrator Relay baseline unavailable: '+String(error.message)+'\n');
    throw error;
  }
}
server.listen(port,'127.0.0.1',()=>console.log('Neo model API on loopback port '+port));
const notificationTimer=setInterval(()=>{void app.orchestrator?.flushNotifications().catch(e=>
  process.stderr.write('[orchestrator-notify] '+String(e.message).slice(0,120)+'\n'));},5000);
notificationTimer.unref();
process.on('SIGTERM',()=>{clearInterval(notificationTimer);server.close(async()=>{await relayMonitor?.stop();await replyListener?.close();process.exit(0)});});
