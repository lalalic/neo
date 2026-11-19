#!/usr/bin/env node
/** Common Neo authenticated model API. No project-specific agent instructions. */
import {readFileSync,statSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {createModelServer} from './server.mjs';
import {createModelReplyListener} from './reply-events.mjs';
const tokenFile=join(homedir(),'.config','neo','models','token');
if(statSync(tokenFile).mode&0o077)throw Error('model token file permissions must be 0600');
const token=readFileSync(tokenFile,'utf8').trim();
const port=Number(process.env.NEO_MODEL_GATEWAY_PORT??8769);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('invalid model gateway port');
const legacyOrigin=process.env.NEO_MODELS_LEGACY_ORIGIN??null;
if(legacyOrigin&&!/^http:\/\/127\.0\.0\.1:\d+$/.test(legacyOrigin))throw Error('legacy origin must be loopback');
const {server,store}=createModelServer({token,legacyOrigin});
// The reply event listener is part of the model delivery contract; fail closed
// if Events Bus is unavailable rather than silently leaving requests pending.
const replyListener=process.env.NEO_MODEL_REPLY_EVENTS!=='0'?createModelReplyListener(store):null;
await replyListener?.start();
server.listen(port,'127.0.0.1',()=>console.log('Neo model API on loopback port '+port));
process.on('SIGTERM',()=>server.close(async()=>{await replyListener?.close();process.exit(0)}));
