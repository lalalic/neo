const CHATGPT_HOSTS = new Set(['chatgpt.com', 'chat.openai.com']);
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

export const DEFAULT_BRIDGE_URL = 'ws://127.0.0.1:8787/ws';

export function isChatGptUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && CHATGPT_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

export function normalizeBridgeUrl(value = DEFAULT_BRIDGE_URL) {
  const url = new URL(String(value || DEFAULT_BRIDGE_URL));
  if (!['ws:', 'wss:'].includes(url.protocol) || !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error('bridge URL must be a loopback WebSocket URL');
  }
  return url.toString();
}

export function bindChild(bindings, childId, tabId) {
  const id = String(childId || '').trim();
  if (!id) throw new Error('child id is required');
  if (!Number.isInteger(tabId) || tabId < 0) throw new Error('valid tab id is required');

  const next = {};
  for (const [existingChild, existingTab] of Object.entries(bindings || {})) {
    if (existingChild !== id && existingTab !== tabId) next[existingChild] = existingTab;
  }
  next[id] = tabId;
  return next;
}

export function validateTurn(message) {
  if (!message || message.type !== 'turn') throw new Error('unsupported bridge message');
  const childId = String(message.childId || '').trim();
  const correlationId = String(message.correlation?.correlationId || '').trim();
  if (!childId) throw new Error('turn child id is required');
  if (!correlationId) throw new Error('turn correlation id is required');
  if (typeof message.prompt !== 'string') throw new Error('turn prompt must be text');

  const attachments = (message.attachments || []).map((attachment) => {
    const url = new URL(String(attachment?.url || ''));
    if (!['http:', 'https:'].includes(url.protocol) || !LOOPBACK_HOSTS.has(url.hostname)) {
      throw new Error('attachment URL must use loopback HTTP');
    }
    const mimeType = String(attachment?.mimeType || '');
    if (!mimeType.startsWith('image/')) throw new Error('only image attachments are supported');
    return {
      url: url.toString(),
      token: String(attachment?.token || ''),
      name: String(attachment?.name || 'image'),
      mimeType,
    };
  });

  return {
    type: 'turn',
    childId,
    prompt: message.prompt,
    correlation: { ...message.correlation, correlationId },
    attachments,
  };
}
