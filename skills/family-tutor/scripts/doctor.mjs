#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const skill=path.dirname(here);
const instance=path.resolve(process.argv[2]||process.cwd());
const config=path.join(instance,'config','family.config.json');
let failed=false;
function check(ok,msg){console.log(`${ok?'✓':'✗'} ${msg}`); if(!ok) failed=true;}
function tokenAvailable(){
  if(process.env.MAC_DEV_BRIDGE_HTTP_TOKEN?.trim()) return true;
  const files=[
    process.env.MAC_DEV_BRIDGE_HTTP_TOKEN_FILE,
    process.env.MAC_DEV_BRIDGE_DATA_DIR ? path.join(process.env.MAC_DEV_BRIDGE_DATA_DIR,'http-token') : null,
    path.join(os.homedir(),'Library','Application Support','MacDeveloperBridge','http-token'),
    path.resolve(skill,'../devmacbridge/.state/http-token'),
  ].filter(Boolean);
  return files.some(file=>{try{return Boolean(fs.readFileSync(file,'utf8').trim())}catch{return false}});
}
check(fs.existsSync(config),`config exists: ${config}`);
check(Boolean(process.env.DISCORD_BOT_TOKEN),'DISCORD_BOT_TOKEN is exported');
check(tokenAvailable(),'DevMacBridge HTTP bearer is available');
const mdbDataDir=process.env.MAC_DEV_BRIDGE_DATA_DIR || path.resolve(skill,'../devmacbridge/.state');
let mdbPort=process.env.MAC_DEV_BRIDGE_HTTP_PORT?.trim() || '';
if(!mdbPort){
  try{
    const envText=fs.readFileSync(path.join(mdbDataDir,'config.env'),'utf8');
    mdbPort=(envText.match(/^MAC_DEV_BRIDGE_HTTP_PORT=(.+)$/m)?.[1]||'').trim();
  }catch{}
}
mdbPort=mdbPort||'8787';
try{const r=await fetch(`http://127.0.0.1:${mdbPort}/healthz`,{signal:AbortSignal.timeout(1500)}); check(r.ok,`DevMacBridge HTTP front end is reachable on ${mdbPort}`);}catch{check(false,`DevMacBridge HTTP front end is reachable on ${mdbPort}`);}
if(fs.existsSync(config)){
  try{
    const cfg=JSON.parse(fs.readFileSync(config,'utf8'));
    check(Boolean(cfg.chatgpt?.projectId),'ChatGPT Project id is configured');
    check(Array.isArray(cfg.children)&&cfg.children.every(c=>c.discordChannelId),'every child has a Discord channel id');
    check(Boolean(cfg.discord?.parentChannelId),'parent channel id is configured');
  }catch(e){check(false,`config parses: ${e.message}`)}
}
process.exitCode=failed?1:0;
