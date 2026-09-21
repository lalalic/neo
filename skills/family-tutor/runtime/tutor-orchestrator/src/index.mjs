import fs from 'node:fs';
import path from 'node:path';
import { Client, Events, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from 'discord.js';
import { loadConfig } from './config.mjs';
import { BrowserBridge } from '../../../mcp-server/src/browser-bridge.mjs';
import { beginThinkingFeedback } from './thinking-feedback.mjs';
import {
  buildParentContextPrompt,
  buildSlashStatusPrompt,
  canUseStatus,
  childProjectName,
  findChildByChannelName,
  formatSlashOverview,
  formatSlashStatus,
  isAuthorizedParent,
  parseParentMessage,
  renderParentNaturalText,
  statusCommand,
  statusDenialMessage,
  validateChildChannel,
} from './parent-context.mjs';
import { buildTutorPrompt, buildVoiceAttachmentPrompt } from './prompt.mjs';

const configFile = process.env.FAMILY_TUTOR_CONFIG;
if (!configFile) throw new Error('FAMILY_TUTOR_CONFIG is required');
const config = loadConfig(configFile);
const discordToken = process.env.DISCORD_BOT_TOKEN?.trim();
if (!discordToken) throw new Error('DISCORD_BOT_TOKEN is required');
if (!config.browserBridge?.enabled) throw new Error('browserBridge.enabled must be true');

const instanceDir = path.resolve(path.dirname(config.configPath), '..');
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
const queues = new Map();
let rememberedParentChildIds = [];
let browserBridge = null;

function agentsFile(child) {
  return path.resolve(instanceDir, child.id, 'AGENTS.md');
}

function ensureAgents(child) {
  const file = agentsFile(child);
  if (fs.existsSync(file)) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `# ${child.name} Agent Context\n\n`, { mode: 0o600 });
}

function learnerMemory(child) {
  try { return fs.readFileSync(agentsFile(child), 'utf8'); } catch { return ''; }
}

for (const child of config.children) ensureAgents(child);

function parseTutorText(text) {
  const raw = String(text || '');
  const parent = raw.match(/<FAMILY_TUTOR_PARENT>\s*([\s\S]*?)\s*<\/FAMILY_TUTOR_PARENT>/i);
  const durable = raw.match(/<FAMILY_TUTOR_MEMORY>\s*([\s\S]*?)\s*<\/FAMILY_TUTOR_MEMORY>/i);
  const childText = raw
    .replace(/<FAMILY_TUTOR_PARENT>[\s\S]*?<\/FAMILY_TUTOR_PARENT>/gi, '')
    .replace(/<FAMILY_TUTOR_MEMORY>[\s\S]*?<\/FAMILY_TUTOR_MEMORY>/gi, '')
    .trim();
  return { childText, parentText: parent?.[1]?.trim() || null, memoryText: durable?.[1]?.trim() || null };
}

function writeMemory(child, text) {
  if (!text) return;
  if (Buffer.byteLength(text, 'utf8') > 100000) throw new Error(`AGENTS.md update for ${child.id} exceeds 100 KB`);
  const file = agentsFile(child);
  const tmp = `${file}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, `${text.trim()}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function applySideEffects(child, parsed) {
  if (parsed.memoryText) writeMemory(child, parsed.memoryText);
}

async function sendChunks(channel, text) {
  let remaining = String(text || '').trim();
  while (remaining.length > 1900) {
    let split = remaining.lastIndexOf('\n', 1900);
    if (split < 800) split = 1900;
    await channel.send(remaining.slice(0, split));
    remaining = remaining.slice(split).trimStart();
  }
  if (remaining) await channel.send(remaining);
}

function collectAttachments(message) {
  return [...message.attachments.values()].slice(0, 4).map((a) => ({
    url: a.url,
    name: a.name || `attachment-${a.id}`,
    mimeType: a.contentType || '',
    size: Number(a.size || 0),
  }));
}

function isAudioAttachment(attachment) {
  return String(attachment.mimeType || '').startsWith('audio/')
    || /\.(ogg|opus|mp3|m4a|wav|webm|aac|flac|aiff?)$/i.test(attachment.name || '');
}

function serialize(key, work) {
  const previous = queues.get(key) || Promise.resolve();
  const next = previous.catch(() => {}).then(work).finally(() => {
    if (queues.get(key) === next) queues.delete(key);
  });
  queues.set(key, next);
  return next;
}

async function browserTurn(child, prompt, attachments, origin) {
  const replies = [];
  await browserBridge.turn({
    childId: child.id,
    prompt: buildTutorPrompt(child.id, learnerMemory(child), prompt, attachments),
    attachments,
    origin,
    reply: async (text) => replies.push(text),
  });
  const parsed = parseTutorText(replies.at(-1) || '');
  applySideEffects(child, parsed);
  return { parsed, replies };
}

async function handleChildMessage(message, child) {
  const attachments = collectAttachments(message);
  const incoming = message.content.trim();
  if (!incoming && !attachments.length) return;
  const audio = attachments.filter(isAudioAttachment);
  const prompt = audio.length
    ? buildVoiceAttachmentPrompt(incoming, audio)
    : incoming || 'Please help me understand the attached file(s).';
  const result = await browserTurn(
    child,
    prompt,
    attachments,
    { channelId: message.channelId, messageId: message.id, threadId: message.channelId },
  );
  await sendChunks(message.channel, result.parsed.childText || result.replies.at(-1) || 'I received your message.');
  if (result.parsed.parentText) {
    const parent = await client.channels.fetch(config.discord.parentChannelId);
    if (parent?.isTextBased()) await sendChunks(parent, `📠 **${child.name}**\n${result.parsed.parentText}`);
  }
}

async function resolveExplicitTargets(channelMentionIds) {
  const targets = [];
  const names = {};
  const seen = new Set();
  for (const id of channelMentionIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const channel = await client.channels.fetch(id);
    const child = findChildByChannelName(config.children, channel?.name);
    if (!child) throw new Error(`Configuration error: Discord channel #${channel?.name || id} must map directly to ChatGPT Project ${childProjectName(channel?.name || '')}.`);
    validateChildChannel(child, channel);
    targets.push(child);
    names[id] = child.name;
  }
  return { targets, names };
}

function rememberedTargets() {
  return rememberedParentChildIds
    .map((id) => config.children.find((child) => child.id === id))
    .filter(Boolean);
}

async function resolveParentTargets(parsed) {
  if (parsed.channelMentionIds?.length) {
    const resolved = await resolveExplicitTargets(parsed.channelMentionIds);
    rememberedParentChildIds = resolved.targets.map((child) => child.id);
    return resolved;
  }
  return { targets: rememberedTargets(), names: {} };
}

async function handleParentControl(message) {
  if (!isAuthorizedParent(message, config)) return;
  const parsed = parseParentMessage(message.content);
  if (!parsed) return;
  if (parsed.command === '!help') {
    return message.reply('Mention one or more child channels naturally. A later message with no child mention reuses the last target set.');
  }
  if (parsed.command === '!threads') {
    return message.reply(config.children.map((child) => `#${child.id} → ${childProjectName(child.id)} → one persistent thread`).join('\n'));
  }

  const { targets, names } = await resolveParentTargets(parsed);
  if (!targets.length) return message.reply('Please mention one or more child channels first, for example: `how is #sammy doing recently?``');
  const value = parsed.channelMentionIds?.length ? renderParentNaturalText(parsed.value, names) : parsed.value;
  if (!value) return message.reply('Please include the question or guidance.');

  const combined = [];
  for (const child of targets) {
    const result = await browserTurn(
      child,
      buildParentContextPrompt({
        child,
        command: parsed.command,
        value,
        authorId: message.author.id,
        messageId: message.id,
        memory: learnerMemory(child),
      }),
      [],
      { channelId: message.channelId, messageId: message.id, threadId: message.channelId },
    );
    combined.push(`**${child.name}**\n${result.parsed.childText || result.replies.at(-1) || 'No privacy-filtered response was returned.'}`);
  }
  return sendChunks(message.channel, combined.join('\l\n\n'));
}

async function statusForChild(child) {
  const result = await browserTurn(
    child,
    buildSlashStatusPrompt({ child, memory: learnerMemory(child) }),
    [],
    { channelId: config.discord.parentChannelId, messageId: `status-${Date.now()}-${child.id}`, threadId: config.discord.parentChannelId },
  );
  return formatSlashStatus(child, result.parsed.childText || result.replies.at(-1));
}

async function handleStatusInteraction(interaction) {
  if (!canUseStatus({ channelId: interaction.channelId }, config)) {
    return interaction.reply({ content: statusDenialMessage(), ephemeral: true });
  }
  const requested = interaction.options.getChannel('child-channel');
  const child = requested ? findChildByChannelName(config.children, requested.name) : null;
  if (requested && !child) {
    return interaction.reply({ content: `Configuration error: #${requested.name} must map directly to ChatGPT Project ${childProjectName(requested.name)}.`, ephemeral: true });
  }
  if (requested) validateChildChannel(child, requested);
  await interaction.deferReply();
  const statuses = [];
  for (const target of child ? [child] : config.children) statuses.push(await serialize(target.id, () => statusForChild(target)));
  return interaction.editReply(formatSlashOverview(statuses));
}

async function syncSlashCommands(applicationId) {
  const rest = new REST({ version: '10' }).setToken(discordToken);
  const command = new SlashCommandBuilder()
    .setName(statusCommand.name)
    .setDescription(statusCommand.description)
    .addChannelOption((option) => option.setName('child-channel').setDescription('Child channel, e.g. #sammy').setRequired(false));
  await rest.put(Routes.applicationCommands(applicationId), { body: [command.toJSON()] });
}

async function processWithThinking(message, work) {
  const feedback = await beginThinkingFeedback(message);
  try {
    return await work();
  } finally {
    await feedback.clear();
  }
}

client.once(Events.ClientReady, async (ready) => {
  await syncSlashCommands(ready.user.id).catch((error) => console.error('[family-tutor] slash command sync failed', error));
  console.log(`[family-tutor-orchestrator] ready as ${ready.user.tag}`);
});

client.on(Events.InteractionCreate, (interaction) => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== statusCommand.name) return;
  handleStatusInteraction(interaction).catch((error) => {
    console.error('[family-tutor] /status failed', error);
    const reply = { content: 'Status is temporarily unavailable.', ephemeral: true };
    if (interaction.deferred || interaction.replied) interaction.editReply(reply).catch(() => {});
    else interaction.reply(reply).catch(() => {});
  });
});

client.on(Events.MessageCreate, (message) => {
  if (message.author.bot) return;
  const child = findChildByChannelName(config.children, message.channel?.name);
  if (child) {
    try { validateChildChannel(child, message.channel); }
    catch (error) { message.reply(error.message).catch(() => {}); return; }
    serialize(child.id, () => processWithThinking(message, () => handleChildMessage(message, child)))
      .catch((error) => { console.error(`[family-tutor] ${child.id} turn failed`, error); message.reply('The tutor is temporarily unavailable.').catch(() => {}); });
    return;
  }

  if (message.channelId === config.discord.parentChannelId) {
    const parsed = parseParentMessage(message.content);
    const key = parsed?.channelMentionIds?.join(',') || rememberedParentChildIds.join(',') || 'parent-control';
    serialize(key, () => processWithThinking(message, () => handleParentControl(message)))
      .catch((error) => { console.error('[family-tutor] parent control failed', error); message.reply(error.message.includes('Configuration error') ? error.message : 'Parent control is temporarily unavailable.').catch(() => {}); });
  }
});

browserBridge = await new BrowserBridge({
  instanceDir,
  children: config.children,
  host: config.browserBridge.host || '127.0.0.1',
  port: config.browserBridge.port || 43117,
  token: process.env.FAMILY_TUTOR_BRIDGE_TOKEN?.trim() || null,
}).start();

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    await browserBridge?.stop().catch(() => {});
    client.destroy();
    process.exit(0);
  });
}

await client.login(discordToken);
