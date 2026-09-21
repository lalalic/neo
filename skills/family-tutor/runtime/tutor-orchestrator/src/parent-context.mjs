export function isAuthorizedParent(message, config) {
  return config.parents.some(parent => parent.role === 'parent' && parent.id === message.author.id);
}

export function parseParentCommand(text) {
  const [command, childId, ...rest] = text.trim().split(/\s+/);
  if (!command?.startsWith('!')) return null;
  if (command === '!help' || command === '!threads') return { command };
  if (!['!goal', '!focus', '!guide', '!ask', '!status'].includes(command)) return { command };
  return { command, childId, value: rest.join(' ').trim() };
}

const discordChannelMention = /<#(\d+)>/g;

export function parseParentMessage(text, children) {
  const command = parseParentCommand(text);
  if (command) return command;
  const mentions = [...String(text || '').matchAll(discordChannelMention)];
  if (mentions.length !== 1) return null;
  const child = children.find((candidate) => candidate.discordChannelId === mentions[0][1]);
  if (!child) return null;
  const value = String(text).replace(discordChannelMention, child.name).replace(/\s+/g, ' ').trim();
  if (!value || value.toLowerCase() === child.name.toLowerCase()) return null;
  return { command: 'parent-query', childId: child.id, value };
}

export function buildParentContextPrompt({ child, command, value, authorId, messageId }) {
  const type = command === '!ask' || command === '!status' || command === 'parent-query' ? 'status-question' : 'guidance-assignment';
  const instruction = command === '!goal'
    ? `Record this as a durable tutoring goal for ${child.name}.`
    : command === '!focus'
      ? `Use this as the current tutoring focus for ${child.name}.`
      : command === '!guide'
        ? `Apply this durable parent guidance for ${child.name}.`
        : 'Answer the parent using only the current learner context and durable AGENTS.md memory.';
  return [
    '[FAMILY TUTOR PARENT CONTEXT]',
    `source=discord-parent type=${type} author=${authorId} message=${messageId}`,
    `target-child=${child.id}`,
    'This context came from an authorized parent. It was not written by the child.',
    "Handle it in this child's existing persistent tutor thread; do not create a second parent thread or memory store.",
    instruction,
    `Parent message: ${value}`,
    type === 'status-question'
      ? 'Return a concise privacy-filtered learning summary: progress/evidence, current difficulty or misconception, next step, and useful parent action. Do not include casual conversation, routine transcript excerpts, or unnecessary private details.'
      : 'Reply briefly to the parent after applying the guidance. Keep durable changes in the complete AGENTS.md replacement marker only.',
    'If the child context contains a serious safety/wellbeing concern or meaningful academic risk requiring support, escalate the minimum necessary signal and suggested parent action using FAMILY_TUTOR_PARENT.'
  ].join('\n');
}

export const statusCommand = { name: 'status', description: 'Show a privacy-filtered learning status for one child or all children' };

export function findChild(children, value) {
  const wanted = String(value || '').trim().toLowerCase();
  if (!wanted) return null;
  return children.find((child) => child.id.toLowerCase() === wanted || child.name.toLowerCase() === wanted) || null;
}

export function buildSlashStatusPrompt({ child, memory }) {
  return [
    `[PARENT STATUS REQUEST] Give a concise, privacy-filtered learning status for ${child.name}.`,
    'Use only this existing child Project/thread and the durable learner context below.',
    'Return at most 4 short bullets covering recent topic, demonstrated understanding or progress, an active misconception or gap, and the next useful step or parent support.',
    'Do not quote or summarize private conversation, casual remarks, sensitive details, or the raw transcript. Say "No recent learning signal" when the context does not support a claim.',
    'This is read-only: do not emit control markers, update AGENTS.md, or create any durable learner-state file.',
    '', '<DURABLE_LEARNER_CONTEXT>', memory || '(No learner context has been recorded yet.)', '</DURABLE_LEARNER_CONTEXT>',
  ].join('\n');
}

export function formatSlashStatus(child, text) {
  const clean = String(text || '').replace(/<FAMILY_TUTOR_PARENT>[\s\S]*?<\/FAMILY_TUTOR_PARENT>/gi, '').replace(/<FAMILY_TUTOR_MEMORY>[\s\S]*?<\/FAMILY_TUTOR_MEMORY>/gi, '').replace(/<FAMILY_TUTOR_ROLLOVER\s*\/\s*>/gi, '').trim();
  if (!clean) return `**${child.name}** — No recent learning signal.`;
  return [`**${child.name}**`, ...clean.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 4)].join('\n');
}

export function formatSlashOverview(statuses) { return statuses.join('\n\n') || 'No configured children.'; }
export function canUseStatus({ channelId, userId }, config) {
  return channelId === config.discord.parentChannelId && config.parents.some((parent) => parent.role === 'parent' && parent.id === userId);
}
export function statusDenialMessage() { return 'This command is available only in the configured parent control channel.'; }
