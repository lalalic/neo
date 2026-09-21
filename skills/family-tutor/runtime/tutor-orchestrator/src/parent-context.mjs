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

export function buildParentContextPrompt({ child, command, value, authorId, messageId }) {
  const type = command === '!ask' || command === '!status' ? 'status-question' : 'guidance-assignment';
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
