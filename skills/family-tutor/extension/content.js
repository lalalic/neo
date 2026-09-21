let activeCorrelationId = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function composer() {
  return document.querySelector('#prompt-textarea, textarea[data-id="root"], textarea[placeholder], [contenteditable="true"][data-lexical-editor="true"]');
}

function fileInput() {
  return document.querySelector('input[type="file"][accept*="image"], input[type="file"]');
}

function sendButton() {
  return document.querySelector('button[data-testid="send-button"], button[aria-label*="Send" i], form button[type="submit"]');
}

async function waitFor(find, label, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = find();
    if (value) return value;
    await sleep(100);
  }
  throw new Error(`${label} not found`);
}

async function uploadImage(attachment) {
  const url = new URL(attachment.url);
  if (attachment.token) url.searchParams.set('token', attachment.token);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`image download failed (${response.status})`);
  const blob = await response.blob();
  const input = await waitFor(fileInput, 'ChatGPT image input');
  const transfer = new DataTransfer();
  transfer.items.add(new File([blob], attachment.name, { type: attachment.mimeType }));
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function fillComposer(field, text) {
  field.focus();
  if (field instanceof HTMLTextAreaElement) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(field, text);
  } else {
    field.textContent = text;
  }
  field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
}

async function submitTurn(message) {
  const correlationId = message.correlation.correlationId;
  if (activeCorrelationId) throw new Error(`tab already processing turn ${activeCorrelationId}`);
  activeCorrelationId = correlationId;
  try {
    for (const attachment of message.attachments || []) await uploadImage(attachment);
    const field = await waitFor(composer, 'ChatGPT composer');
    fillComposer(field, message.prompt);
    const button = await waitFor(() => {
      const candidate = sendButton();
      return candidate && !candidate.disabled ? candidate : null;
    }, 'enabled ChatGPT send button');
    button.click();
    await chrome.runtime.sendMessage({ type: 'turn.ack', childId: message.childId, correlation: message.correlation });
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
