#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const instance=path.resolve(process.argv[2]||process.cwd());
const config=path.join(instance,'config','family.config.json');
let failed=false;
function check(ok,msg){console.log(`${ok?'✓':'✗'} ${msg}`); if(!ok) failed=true;}
check(fs.existsSync(config),`config exists: ${config}`);
check(Boolean(process.env.DISCORD_BOT_TOKEN),'DISCORD_BOT_TOKEN is exported');
if(fs.existsSync(config)){
  try{
    const cfg=JSON.parse(fs.readFileSync(config,'utf8'));
    check(Array.isArray(cfg.children)&&cfg.children.every(c=>c.id && c.name),'every child has a canonical Discord channel-name id');
    check(cfg.browserBridge?.enabled===true,'browser bridge is enabled');
    check(['127.0.0.1','localhost','::1'].includes(cfg.browserBridge?.host||'127.0.0.1'),'browser bridge is loopback-only');
    check(Array.isArray(cfg.children)&&cfg.children.every(c=>!Object.keys(c).some(key=>/alias|aliases|channelId|discordChannelId/i.test(key))),'children use exact channel names without legacy mappings');
    check(Boolean(cfg.discord?.parentChannelId),'parent channel id is configured');
  }catch(e){check(false,`config parses: ${e.message}`)}
}
process.exitCode=failed?1:0;
