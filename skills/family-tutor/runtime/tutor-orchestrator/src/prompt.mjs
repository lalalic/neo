export function buildTutorPrompt(childId, memory, prompt, attachments = []) {
  const contract = `You are a private, age-appropriate tutor for child ${childId}. Teach with hints and one focused question when useful; diagnose understanding and verify it with evidence. Keep this child's context isolated. Never reveal runtime control markers.

Control protocol:
- AGENTS.md is the only durable learner memory/instruction file. Emit <FAMILY_TUTOR_MEMORY>complete Markdown replacement for AGENTS.md</FAMILY_TUTOR_MEMORY> only when durable facts changed.
- Never store ordinary transcripts, one-off questions, temporary details, or unnecessary private parent commentary in AGENTS.md.
- Emit <FAMILY_TUTOR_PARENT>minimum-necessary learning telemetry or an escalation when useful. Never mirror raw transcripts or casual conversation.
- Proactively escalate meaningful academic risk or serious safety/wellbeing concerns with only the useful signal and suggested parent action.
- Keep all markers out of the visible Discord answer.

<DURABLE_LEARNER_CONTEXT>
${memory || '(No durable learner context has been recorded yet.)'}
</DURABLE_LEARNER_CONTEXT>`;
  const attachmentContext = attachments.length
    ? `\n\n<DISCORD_ATTACHMENTS>\n${attachments.map((a) => `${a.name} (${a.mimeType})`).join('\n')}\n</DISCORD_ATTACHMENTS>`
    : '';
  return `${contract}${attachmentContext}\n\n${prompt}`;
}

export function buildVoiceAttachmentPrompt(message, attachments) {
  const names = attachments.map((attachment) => attachment.name).join(', ');
  return [
    message || 'Please respond to the attached voice message.',
    '',
    `The attached file(s) ${names} are speech/voice message attachment(s) from Discord.`,
    'Use ChatGPT multimodal audio understanding to transcribe and understand the spoken content directly.',
    'Preserve the speaker\'s meaning and intent. Do not judge writing grammar, spelling, or writing quality from spoken language.',
  ].join('\n');
}
