#!/usr/bin/env node
/** Common Neo authenticated model API. No project-specific agent instructions. */
import {readFileSync,statSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {createModelServer} from './server.mjs';
const tokenFile=join(homedir(),'.config','neo','models','token');
if(statSync(tokenFile).mode&0o077)throw Error('model token file permissions must be 0600');
const token=readFileSync(tokenFile,'utf8').trim();
const port=Number(process.env.NEO_MODEL_GATEWAY_PORT??8769);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('invalid model gateway port');
const legacyOrigin=process.env.NEO_MODELS_LEGACY_ORIGIN??null;
if(legacyOrigin&&!/^http:\/\/127\.0\.0\.1:\d+$/.test(legacyOrigin))throw Error('legacy origin must be loopback');
const {server}=createModelServer({token,legacyOrigin});
server.listen(port,'127.0.0.1',()=>console.log('Neo model API on loopback port '+port));
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
