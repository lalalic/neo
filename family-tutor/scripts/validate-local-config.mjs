#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function validateConfig(config) {
  if (config.version !== 1) throw Error('Unsupported config version');
  if ((config.discord?.mode || 'local') !== 'local') {
    throw Error('Cloudflare transport is unsupported; set discord.mode=local');
  }
  if (!config.browserWorkspace?.enabled) throw Error('Browser Workspace must be enabled');
  if (!Array.isArray(config.children) || !config.children.length) {
    throw Error('Configure at least one child before start');
  }
  if (!config.discord?.parentChannelId) throw Error('Configure the parent channel');
  const ids=new Set();
  for(const child of config.children) {
    if (!child.id || !child.name || ids.has(child.id)) throw Error('Invalid or duplicate child');
    ids.add(child.id);
  }
  return true;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  try { validateConfig(JSON.parse(readFileSync(process.argv[2], 'utf8'))); }
  catch (error) { console.error(error.message); process.exitCode=1; }
}
