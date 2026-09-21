import fs from 'node:fs';
import path from 'node:path';

function nonEmpty(value) {
  return typeof value === 'string' && value.trim() !== '';
}

export function loadConfig(file) {
  const configPath = path.resolve(file);
  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  if (cfg.version !== 1) throw new Error(`Unsupported config version: ${cfg.version}`);
  if (!Array.isArray(cfg.children) || cfg.children.length === 0) throw new Error('children must be a non-empty array');
  if (!nonEmpty(cfg.discord?.parentChannelId)) throw new Error('discord.parentChannelId is required');
  if (cfg.browserBridge?.enabled !== true) throw new Error('browserBridge.enabled must be true');

  const browserHost = cfg.browserBridge.host || '127.0.0.1';
  if (!['127.0.0.1', 'localhost', '::1'].includes(browserHost)) throw new Error('browserBridge.host must be loopback');
  const browserPort = Number(cfg.browserBridge.port || 43117);
  if (!Number.isInteger(browserPort) || browserPort < 1024 || browserPort > 65535) throw new Error('browserBridge.port must be between 1024 and 65535');

  const ids = new Set();
  for (const child of cfg.children) {
    if (!nonEmpty(child.id) || !nonEmpty(child.name)) throw new Error('each child requires canonical id (the Discord channel name) and name');
    if (ids.has(child.id)) throw new Error(`duplicate child id: ${child.id}`);
    if (Object.keys(child).some((key) => ['alias', 'aliases', 'channelId', 'discordChannelId', 'project', 'projectId', 'tabId', 'tutorProfile', 'grade', 'gender', 'school', 'location'].includes(key))) {
      throw new Error(`child ${child.id} must use its Discord channel name as the sole routing key; learner memory belongs in AGENTS.md and browser bindings belong in extension runtime state`);
    }
    ids.add(child.id);
  }

  return { ...cfg, configPath };
}
