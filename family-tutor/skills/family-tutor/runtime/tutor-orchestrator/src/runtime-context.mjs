function assertType(type) {
  if (type !== 'kid' && type !== 'parent') throw new Error(`unsupported runtime context type: ${type}`);
}

export function runtimeContext(type, data) {
  assertType(type);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('runtime context data must be an object');
  return `<FAMILY_TUTOR_CONTEXT>\n${JSON.stringify({ type, data })}\n</FAMILY_TUTOR_CONTEXT>`;
}

function messageContext(type,{ senderName, message, correlationId }) {
  const data={
    senderName: String(senderName || ''),
    message: String(message || ''),
  };
  if(correlationId) data.correlationId=String(correlationId);
  const envelope=runtimeContext(type,data);
  if(!correlationId) return envelope;
  return `${envelope}

DELIVERY CONTRACT: This is a Discord-originated turn. You MUST use the configured @neo MCP tool discord with command="reply" and args={"correlationId":"${correlationId}","text":"<your Discord-ready response>"} to send your response. Text shown in ChatGPT is not delivered to Discord. Do not finish without a successful tool receipt. When Webhelm merges several pending Discord messages, reply separately to every correlationId in the merged turn. Do not infer or select another channel. No final flag is used.`;

}

export function buildKidContext({ childName, text, correlationId }) {
  return messageContext('kid', { senderName: childName || 'Kid', message: text, correlationId });
}

export function buildParentContext({ text, correlationId }) {
  return messageContext('parent', { senderName: 'Parents', message: text, correlationId });
}
