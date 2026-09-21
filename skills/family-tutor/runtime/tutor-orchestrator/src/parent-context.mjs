export function isAuthorizedParent(message, config) {
  return Boolean(config.discord?.parentChannelId && message.channelId === config.discord.parentChannelId);
}

const discordChannelMention = /<#(\d+)>/g;
const normalizeWhitespace = (text) => String(text || '').replace(/\s+/g, ' ').trim();

export function parseParentCommand(text) {
  const [command, ...rest] = normalizeWhitespace(text).split(/\s+/);
  if (!command?.startsWith('!')) return null;
  if (command === '!help' || command === '!threads') return { command };
  if (!['!goal', '!focus', '!guide', '!ask', '!status'].includes(command)) return { command };
  return { command, value: rest.join(' ').trim() };
}

export function parseParentMessage(text) {
  const input = String(text || '').trim();
  if (!input) return null;
  const channelMentionIds = [...input.matchAll(discordChannelMention)].map((match) => match[1]);
  const withoutMentions = normalizeWhitespace(input.replace(discordChannelMention, ' '));
  const command = parseParentCommand(withoutMentions);
  if (command?.command === '!help' || command?.command === '!threads') return { ...command, channelMentionIds };
  if (command) return { ...command, channelMentionIds };
  return { command: 'parent-query', value: input, channelMentionIds };
}

export function renderParentNaturalText(input, channelNames = {}) {
  return normalizeWhitespace(String(input || '').replace(discordChannelMention, (_match, id) => channelNames[id] || ''));
}

function parentQueryType(value) {
  const text = normalizeWhitespace(value);
  const assignment = /\b(?:review|practice|complete|finish|work on|focus on|study|prepare|read|write|try|remind|make sure|have .* do)\b/i.test(text)
    && !/\b(?:status|progress|how(?:'s| is| are| was| were)?|recent|going|learning|doing)\b/i.test(text);
  return !assignment && /(?:\?|\bhow(?:'s| is| are| was| were)?\b|\bstatus\b|\bprogress\b|\bdoing\b|\bgoing\b|\blearning\b|\bunderstand(?:ing)?\b|\bstruggl(?:e|es|ing)\b|\bimprov(?:e|ing|ement)\b|\brecent\b)/i.test(text)
    ? 'status-question'
    : 'guidance-assignment';
}

export function buildParentContextPrompt({ child, command, value, authorId, messageId, memory = '' }) {
  const type = command === '!ask' || command === '!status'
    ? 'status-question'
    : command === 'parent-query' ? parentQueryType(value) : 'guidance-assignment';
  const instruction = command === '!goal'
    ? `Record this as a durable tutoring goal for ${child.name}.`
    : command === '!focus'
      ? `Use this as the current tutoring focus for ${child.name}.`
      : command === '!guide'
        ? `Apply this durable parent guidance for ${child.name}.`
        : type === 'status-question'
          ? 'Answer the parent using the current learner context and durable AGENTS.md memory.'
          : 'Apply this parent guidance when pedagogically appropriate.';
  return [
    '[FAMILY TUTOR PARENT CONTEXT]',
    `source=discord-parent type=${type} author=${authorId} message=${messageId}`,
    `target-child=${child.id}`,
    `target-project=${childProjectName(child.id)}`,
    'This context came from the configured #parents channel. It was not written by the child.',
    "Handle it in this child's existing persistent ChatGPT Project thread; do not create a second parent thread or memory store.",
    instruction,
    `Parent message: ${value}`,
    type === 'status-question'
      ? 'Return a concise privacy-filtered learning summary: progress/evidence, current difficulty or misconception, next step, and useful parent action. Do not include casual conversation, routine transcript excerpts, or unnecessary private details.'
      : 'Reply briefly to the parent after applying the guidance. If this creates durable guidance, update only AGENTS.md through the FAMILY_TUTOR_MEMORY protocol.',
    'If the child context contains a serious safety/wellbeing concern or meaningful academic risk requiring support, escalate the minimum necessary signal and suggested parent action using FAMILY_TUTOR_PARENT.',
    '',
    '<DURABLE_LEARNER_CONTEXT>',
    memory || '(No durable learner context has been recorded yet.)',
    '</DURABLE_LEARNER_CONTEXT>',
  ].join('\n');
}

export const statusCommand = { name: 'status', description: 'Show a privacy-filtered learning status for one child or all children' };

export function findChildByChannelName(children, channelName) {
  return children.find((child) => child.id === String(channelName || '').trim()) || null;
}

export function childProjectName(channelName) {
  return `neo/family-tutor/${String(channelName || '').trim()}`;
}

export function validateChildChannel(child, channel) {
  const channelName = String(channel?.name || '').trim();
  if (!channelName) throw new Error('Family Tutor configuration error: Discord child channel has no name.');
  if (channelName !== child.id) throw new Error(`Family Tutor configuration error: Discord channel #${channelName} must match child id/project suffix ${child.id}.`);
  return { childId: channelName, project: childProjectName(channelName) };
}

export function buildSlashStatusPrompt({ child, memory }) {
  return [
    `[PARENT STATUS REQUEST] Give a concise, privacy-filtered learning status for ${child.name}.`,
    `Use only the existing persistent thread in Project ${childProjectName(child.id)} and this child's AGENTS.md context below.`,
    'Return at most 4 short bullets covering recent topic, demonstrated understanding or progress, an active misconception or gap, and the next useful step or parent support.',
    'Do not quote or summarize private conversation, casual remarks, sensitive details, or the raw transcript. Say "No recent learning signal" when the context does not support a claim.',
    'This is read-only: do not emit control markers, update AGENTS.md, or create any durable learner-state file.',
    '',
    '<DURABLE_LEARNER_CONTEXT>',
    memory || '(No durable learner context has been recorded yet.)',
    '</DURABLE_LEARNER_CONTEXT>',
  ].join('\n');
}

export function formatSlashStatus(child, text) {
  const clean = String(text || '').replace(/<FAMILY_TUTOR_[A-Z_]+>[\s\S]*?<\/FAMILY_TUTOR_[A-Z_]+>/gi, '').trim();
  return clean
    ? [`**${child.name}**`, ...clean.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 4)].join('\n')
    : `**${child.name}** — No recent learning signal.`;
}

export function formatSlashOverview(statuses) {
  return statuses.join('\n\n') || 'No configured learners.';
}

export function canUseStatus({ channelId }, config) {
  return channelId === config.discord.parentChannelId;
}

export function statusDenialMessage() {
  return 'This command is available only in the configured #parents channel.';
}
