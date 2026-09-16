import fs from 'node:fs';
import path from 'node:path';
function nonEmpty(v){ return typeof v === 'string' && v.trim() !== ''; }
export function loadConfig(file){
  const configPath=path.resolve(file);
  const cfg=JSON.parse(fs.readFileSync(configPath,'utf8'));
  if(cfg.version!==1) throw new Error(`Unsupported config version: ${cfg.version}`);
  if(!Array.isArray(cfg.children)||cfg.children.length===0) throw new Error('children must be a non-empty array');
  if(!nonEmpty(cfg.discord?.parentChannelId)) throw new Error('discord.parentChannelId is required');
  if(cfg.chatgpt?.backend!=='devmacbridge') throw new Error(`Unsupported chatgpt backend: ${cfg.chatgpt?.backend}`);
  const ids=new Set(), channels=new Set(), conversations=new Set();
  for(const child of cfg.children){
    if(!nonEmpty(child.id)||!nonEmpty(child.name)||!nonEmpty(child.discordChannelId)) throw new Error('each child requires id, name, and discordChannelId');
    if(ids.has(child.id)) throw new Error(`duplicate child id: ${child.id}`);
    if(channels.has(child.discordChannelId)) throw new Error(`duplicate child Discord channel: ${child.discordChannelId}`);
    ids.add(child.id); channels.add(child.discordChannelId);
    if(nonEmpty(child.conversationId)){
      if(conversations.has(child.conversationId)) throw new Error(`duplicate ChatGPT conversation id: ${child.conversationId}`);
      conversations.add(child.conversationId);
    }
  }
  const stateFile=path.resolve(path.dirname(configPath),cfg.runtime?.stateFile||'data/runtime.json');
  return {...cfg,configPath,stateFile};
}
