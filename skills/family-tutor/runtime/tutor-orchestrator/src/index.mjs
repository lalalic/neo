import fs from 'node:fs';
import path from 'node:path';
import { Client, Events, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from 'discord.js';
import { loadConfig } from './config.mjs';
import { BrowserBridge } from '../../mcp-server/src/browser-bridge.mjs';
import { buildParentContextPrompt, buildSlashStatusPrompt, canUseStatus, childProjectName, findChildByChannelName, formatSlashOverview, formatSlashStatus, isAuthorizedParent, parseParentMessage, renderParentNaturalText, statusCommand, statusDenialMessage, validateChildChannel } from './parent-context.mjs';
import { buildTutorPrompt, buildVoiceAttachmentPrompt } from './prompt.mjs';

const configFile = process.env.FAMILY_TUTOR_CONFIG;
if (!configFile) throw new Error('FAMILY_TUTOR_CONFIG is required');
const config = loadConfig(configFile);
const discordToken = process.env.DISCORD_BOT_TOKEN?.trim();
if (!discordToken) throw new Error('DISCORD_BOT_TOKEN is required');
const instanceDir = path.resolve(path.dirname(config.configPath), '..');
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
const queues = new Map();
const rememberedParentTargets = [];
let browserBridge;

function agentsFile(child) { return path.resolve(instanceDir, child.id, 'AGENTS.md'); }
function ensureAgents(child) { const file = agentsFile(child); if (!fs.existsSync(file)) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `# ${child.name} Agent Context\n\n`, { mode: 0o600 }); } }
function memory(child) { try { return fs.readFileSync(agentsFile(child), 'utf8'); } catch { return ''; } }
for (const child of config.children) ensureAgents(child);
function parseTutorText(text) {
  const raw = String(text || '');
  const parent = raw.match(/<FAMILY_TUTOR_PARENT>\s*([\s\S]*?)\s*<\/FAMILY_TUTOR_PARENT>/i);
  const durable = raw.match(/<FAMILY_TUTOR_MEMORY>\s*([\s\S]*?)\s*<\/FAMILY_TUTOR_MEMORY>/i);
  return { childText: raw.replace(/<FAMILY_TUTOR_PARENT>[\s\S]*?<\/FAMILY_TUTOR_PARENT>/gi, '').replace(/<FAMILY_TUTOR_MEMORY>[\s\S]*?<\/FAMILY_TUTOR_MEMORY>/gi, '').trim(), parentText: parent?.[1]?.trim() || null, memoryText: durable?.[1]?.trim() || null };
}
function writeMemory(child, text) {
  if (!text) return;
  if (Buffer.byteLength(text, 'utf8') > 100000) throw new Error(`AGENTS.md update for ${child.id} exceeds 100 KB`);
  const file = agentsFile(child); const tmp = `${file}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(tmp, `${text.trim()}\n`, { mode: 0o600 }); fs.renameSync(tmp, file);
}
function applySideEffects(child, parsed) { if (parsed.memoryText) writeMemory(child, parsed.memoryText); }
async function sendChunks(channel, text) { let remaining = String(text || '').trim(); while (remaining.length > 1900) { let split = remaining.lastIndexOf('\n', 1900); if (split < 800) split = 1900; await channel.send(remaining.slice(0, split)); remaining = remaining.slice(split).trimStart(); } if (remaining) await channel.send(remaining); }
function collectAttachments(message) { return [...message.attachments.values()].slice(0, 4).map((a) => ({ url: a.url, name: a.name || `attachment-${a.id}`, mimeType: a.contentType || '', size: Number(a.size || 0) })); }
function serialize(key, work) { const previous = queues.get(key) || Promise.resolve(); const next = previous.catch(() => {}).then(work).finally(() => { if (queues.get(key) === next) queues.delete(key); }); queues.set(key, next); return next; }

async function browserTurn(child, prompt, attachments, origin) {
  const replies = [];
  const result = await browserBridge.turn({ childId: child.id, prompt: buildTutorPrompt(child.id, memory(child), prompt, attachments), attachments, origin, reply: async (text) => replies.push(text) });
  const parsed = parseTutorText(replies.at(-1) || result.text || '');
  applySideEffects(child, parsed);
  return { parsed, replies };
}
async function handleChildMessage(message, child) {
  const attachments = collectAttachments(message);
  if (!message.content.trim() && !attachments.length) return;
  const audio = attachments.filter((a) => a.mimeType.startsWith('audio/') || /\.(ogg|opus|mp3|m4a|wav|webm|aac|flac|aiff?)$/i.test(a.name));
  const prompt = audio.length ? buildVoiceAttachmentPrompt(message.content.trim(), audio) : (message.content.trim() || 'Please help me understand the attached file(s).');
  const result = await browserTurn(child, prompt, attachments, { channelId: message.channelId, messageId: message.id, threadId: message.channelId });
  await sendChunks(message.channel, result.parsed.childText || 'I received your message.');
  if (result.parsed.parentText) { const parent = await client.channels.fetch(config.discord.parentChannelId); if (parent?.isTextBased()) await sendChunks(parent, `📘 **${child.name}**\n${result.parsed.parentText}`); }
}
async function resolveTargets(parsed) {
  const explicit = Boolean(parsed.channelMentionIds?.length);
  const ids = explicit ? parsed.channelMentionIds : [...rememberedParentTargets];
  if (!ids.length) return { targets: [], names: {} };
  const targets = []; const names = {};
  for (const id of ids) {
    const channel = explicit ? await client.channels.fetch(id) : { name: id };
    const child = findChildByChannelName(config.children, channel?.name);
    if (!child) throw new Error(`Configuration error: Discord channel #${channel?.name || id} must map directly to ChatGPT Project ${childProjectName(channel?.name || '')}.`);
    if (explicit) validateChildChannel(child, channel);
    targets.push(child); names[id] = channel.name;
  }
  if (explicit) rememberedParentTargets.splice(0, rememberedParentTargets.length, ...targets.map((child) => child.id));
  return { targets, names };
}
async function handleParentControl(message) {
  if (!isAuthorizedParent(message, config)) return;
  const parsed = parseParentMessage(message.content);
  if (!parsed) return;
  if (parsed.command === '!help') return message.reply('Mention one or more configured child channels anywhere in a request; a later request may omit the mention and reuse the last target set.');
  if (parsed.command === '!threads') return message.reply(config.children.map((child) => `${child.id}: one persistent ChatGPT Project thread`).join('\n'));
  const { targets, names } = await resolveTargets(parsed);
  if (!targets.length) return message.reply('Please mention one or more configured child channels.');
  if (!parsed.value) return message.reply('Please include the goal, guidance, or question.');
  const value = renderParentNaturalText(parsed.value, names);
  const combined = [];
  for (const child of targets) {
    const result = await browserTurn(child, buildParentContextPrompt({ child, command: parsed.command, value, authorId: message.author.id, messageId: message.id }), [], { channelId: message.channelId, messageId: message.id, threadId: message.channelId });
    combined.push(`**${child.name}**\n${result.parsed.childText || result.replies.at(-1) || 'No privacy-filtered response was returned.'}`);
  }
  return sendChunks(message.channel, combined.join('\n\n'));
}
async function statusForChild(child) {
  const result = await browserTurn(child, buildSlashStatusPrompt({ child, memory: memory(child) }), [], { channelId: config.discord.parentChannelId, messageId: `status-${Date.now()}`, threadId: config.discord.parentChannelId });
  return formatSlashStatus(child, result.parsed.childText);
}
async function handleStatusInteraction(interaction) {
  if (!canUseStatus({ channelId: interaction.channelId, userId: interaction.user.id }, config)) return interaction.reply({ content: statusDenialMessage(), ephemeral: true });
  const requested = interaction.options.getChannel('child-channel');
  const child = requested ? findChildByChannelName(config.children, requested.name) : null;
  if (requested && !child) return interaction.reply({ content: `Configuration error: #${requested.name} must map directly to ChatGPT Project ${childProjectName(requested.name)}.`, ephemeral: true });
  if (requested) validateChildChannel(child, requested);
  await interaction.deferReply();
  const statuses = [];
  for (const target of child ? [child] : config.children) statuses.push(await statusForChild(target));
  return interaction.editReply(formatSlashOverview(statuses));
}
client.once(Events.ClientReady, async (ready) => { const rest = new REST({ version: '10' }).setToken(discordToken); const command = new SlashCommandBuilder().setName(statusCommand.name).setDescription(statusCommand.description).addChannelOption((option) => option.setName('child-channel').setDescription('Configured child channel (optional)').setRequired(false)); await rest.put(Routes.applicationCommands(ready.user.id), { body: [command.toJSON()] }); console.log(`[family-tutor-orchestrator] ready as ${ready.user.tag}`); });
client.on(Events.InteractionCreate, (interaction) => { if (interaction.isChatInputCommand() && interaction.commandName === statusCommand.name) handleStatusInteraction(interaction).catch(() => interaction.reply({ content: 'Status is temporarily unavailable.', ephemeral: true }).catch(() => {})); });
client.on(Events.MessageCreate, (message) => { if (message.author.bot) return; const child = findChildByChannelName(config.children, message.channel?.name); if (child) { serialize(child.id, () => handleChildMessage(message, child)).catch(() => message.reply('The tutor is temporarily unavailable.').catch(() => {})); return; } if (message.channelId === config.discord.parentChannelId) { const parsed = parseParentMessage(message.content); const key = parsed?.channelMentionIds?.join(',') || 'parent-control'; serialize(key, () => handleParentControl(message)).catch((error) => message.reply(error.message.includes('Configuration error') ? error.message : 'Parent control is temporarily unavailable.').catch(() => {})); } });
if (!config.browserBridge?.enabled) throw new Error('browserBridge.enabled must be true; the Codex-only backend is obsolete');
browserBridge = await new BrowserBridge({ instanceDir, children: config.children, host: config.browserBridge.host || '127.0.0.1', port: config.browserBridge.port || 43117, token: process.env.FAMILY_TUTOR_BRIDGE_TOKEN?.trim() || null }).start();
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await browserBridge.stop(); client.destroy(); process.exit(0); });
await client.login(discordToken);
