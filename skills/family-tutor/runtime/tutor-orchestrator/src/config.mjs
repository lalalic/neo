import fs from 'node:fs';
import path from 'node:path';
function nonEmpty(v){ return typeof v === 'string' && v.trim() !== ''; }
export function loadConfig(file){
  const configPath=path.resolve(file);
  const cfg=JSON.parse(fs.readFileSync(configPath,'utf8'));
  if(cfg.version!==1) throw new Error(`Unsupported config version: ${cfg.version}`);
  if(!Array.isArray(cfg.children)||cfg.children.length===0) throw new Error('children must be a non-empty array');
  if(!nonEmpty(cfg.discord?.parentChannelId)) throw new Error('discord.parentChannelId is required');
  if(!Array.isArray(cfg.parents)||cfg.parents.length===0) throw new Error('parents must contain authorized parent accounts');
  if(cfg.codex?.backend!=='codex') throw new Error(`Unsupported codex backend: ${cfg.codex?.backend}`);
  const ids=new Set();
  for(const child of cfg.children){
    if(!nonEmpty(child.id)||!nonEmpty(child.name)) throw new Error('each child requires canonical id (the Discord channel name) and name');
    if(ids.has(child.id)) throw new Error(`duplicate child id: ${child.id}`);
    if(child.project) throw new Error(`child ${child.id} must not define a separate Project mapping; use neo/family-tutor/${child.id}`);
    ids.add(child.id);
  }
  const parentIds=new Set();
  for(const parent of cfg.parents){
    if(!nonEmpty(parent.id)||parent.role!=='parent') throw new Error('each parent requires an id and role=parent');
    if(parentIds.has(parent.id)) throw new Error(`duplicate parent id: ${parent.id}`);
    parentIds.add(parent.id);
  }
  return {...cfg,configPath};
}
