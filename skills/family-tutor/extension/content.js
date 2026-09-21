let activeCorrelationId = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const normalized = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const userTurns = () => [...document.querySelectorAll('[data-message-author-role="user"]')]
  .map((element) => ({ text: element.innerText?.trim() || '', id: element.getAttribute('data-message-id') || '' }))
  .filter((turn) => turn.text);

function composer() {
  return document.querySelector('#prompt-textarea, textarea[data-id="root"], textarea[placeholder], [contenteditable="true"][data-lexical-editor="true"]');
}

function fileInput() {
  return document.querySelector('input[type="file"][accept*="image"], input[type="file"]');
}

function sendButton() {
  return document.querySelector('button[data-testid="send-button"], button[aria-label*="Send" i], form button[type="submit"]');
}

function attachmentNames() {
  return [...document.querySelectorAll('button[aria-label^="Remove file"]')]
    .map((button) => (button.getAttribute('aria-label') || '').replace(/^Remove file\s+\d+:\s*/, ''))
    .filter(Boolean);
}

async function waitFor(find, label, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = find();
    if (value) return value;
    await sleep(150);
  }
  throw new Error(`${label} not found`);
}

async function uploadImage(attachment) {
  const fetched = await chrome.runtime.sendMessage({
    type: 'attachment.fetch',
    url: attachment.url,
    token: attachment.token,
    mimeType: attachment.mimeType,
  });
  if (!fetched?.ok || !fetched.base64) throw new Error(fetched?.error || 'image download failed');
  const binary = atob(fetched.base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: fetched.mimeType || attachment.mimeType });
  const input = await waitFor(fileInput, 'ChatGPT image input');
  const transfer = new DataTransfer();
  transfer.items.add(new File([blob], attachment.name, { type: attachment.mimeType }));
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => attachmentNames().includes(attachment.name), `ChatGPT attachment ${attachment.name}`, 30000);
}

function fillComposer(field, text) {
  field.focus();
  if (field instanceof HTMLTextAreaElement) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(field, text);
    field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    return;
  }
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(field);
  selection?.removeAllRanges();
  selection?.addRange(range);
  const inserted = document.execCommand('insertText', false, text);
  selection?.removeAllRanges();
  if (!inserted) {
    field.textContent = text;
    field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  }
}

async function waitForUserTurn(beforeCount, prompt, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const turns = userTurns();
    for (const turn of turns.slice(beforeCount)) {
      if (normalized(turn.text).includes(normalized(prompt))) return turn;
    }
    await sleep(250);
  }
  throw new Error('submitted prompt did not become a durable ChatGPT user turn');
}

async function submitTurn(message) {
  const correlationId = message.correlation.correlationId;
  if (activeCorrelationId) throw new Error(`tab already processing turn ${activeCorrelationId}`);
  activeCorrelationId = correlationId;
  try {
    const beforeCount = userTurns().length;
    for (const attachment of message.attachments || []) await uploadImage(attachment);
    const field = await waitFor(composer, 'ChatGPT composer');
    fillComposer(field, message.prompt);
    await waitFor(
      () => normalized(field.innerText ?? field.value).includes(normalized(message.prompt)),
      'ChatGPT composer text',
      15000,
    );
    const button = await waitFor(() => {
      const candidate = sendButton();
      return candidate && !candidate.disabled && candidate.getAttribute('aria-disabled') !== 'true' ? candidate : null;
    }, 'enabled ChatGPT send button');
    button.click();
    const turn = await waitForUserTurn(beforeCount, message.prompt);
    await chrome.runtime.sendMessage({ type: 'turn.ack', childId: message.childId, correlation: message.correlation });
    return turn;
  } finally {
    activeCorrelationId = null;
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== 'turn') return;
  submitTurn(message).catch((error) => chrome.runtime.sendMessage({
    type: 'turn.error',
    childId: message.childId,
    correlation: message.correlation,
    error: error instanceof Error ? error.message : String(error),
  }));
});
