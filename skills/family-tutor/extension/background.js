import { DEFAULT_BRIDGE_URL, bindChild, isChatGptUrl, normalizeBridgeUrl, validateTurn } from './protocol.mjs';

let socket = null;
let reconnectTimer = null;
let keepAliveTimer = null;

async function settings() {
  return chrome.storage.local.get({ bridgeUrl: DEFAULT_BRIDGE_URL, token: '', bindings: {} });
}

function send(message) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

async function reportBindings() {
  const { bindings } = await settings();
  for (const childId of Object.keys(bindings)) send({ type: 'tab.bind', childId });
}

async function handleTurn(raw) {
  const turn = validateTurn(raw);
  const { bindings } = await settings();
  const tabId = bindings[turn.childId];
  if (!Number.isInteger(tabId)) throw new Error(`no ChatGPT tab is bound for child ${turn.childId}`);

  const tab = await chrome.tabs.get(tabId);
  if (!isChatGptUrl(tab.url)) throw new Error(`bound tab for ${turn.childId} is not a ChatGPT tab`);
  await chrome.tabs.sendMessage(tabId, turn);
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connect, 1500);
}

async function connect() {
  const config = await settings();
  if (!config.token || socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;

  const url = new URL(normalizeBridgeUrl(config.bridgeUrl));
  url.searchParams.set('token', config.token);
  socket = new WebSocket(url);
  socket.onopen = async () => {
    await reportBindings();
    clearInterval(keepAliveTimer);
    keepAliveTimer = setInterval(() => send({ type: 'extension.ping' }), 20_000);
  };
  socket.onmessage = async ({ data }) => {
    let message;
    try {
      message = JSON.parse(data);
      if (message.type !== 'turn') return;
      await handleTurn(message);
    } catch (error) {
      send({
        type: 'turn.error',
        childId: message?.childId,
        correlation: message?.correlation,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
  socket.onclose = () => {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
    socket = null;
    scheduleReconnect();
  };
  socket.onerror = () => socket?.close();
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type === 'turn.ack' || message?.type === 'turn.error') {
    send(message);
    return;
  }

  if (message?.type === 'settings.get') {
    settings().then(({ bridgeUrl, bindings }) => respond({ bridgeUrl, bindings })).catch((error) => respond({ error: error.message }));
    return true;
  }

  if (message?.type === 'bind.current') {
    (async () => {
      const tabId = message.tabId ?? sender.tab?.id;
      const tab = await chrome.tabs.get(tabId);
      if (!isChatGptUrl(tab.url)) throw new Error('open the child ChatGPT tab before binding');

      const current = await settings();
      const bridgeUrl = normalizeBridgeUrl(message.bridgeUrl || current.bridgeUrl);
      const token = String(message.token || current.token || '').trim();
      if (!token) throw new Error('bridge token is required');
      const bindings = bindChild(current.bindings, message.childId, tabId);
      await chrome.storage.local.set({ bridgeUrl, token, bindings });
      if (socket) socket.close(); else connect();
      respond({ ok: true, bindings });
    })().catch((error) => respond({ error: error.message }));
    return true;
  }

  if (message?.type === 'unbind.current') {
    (async () => {
      const { bindings } = await settings();
      const next = Object.fromEntries(Object.entries(bindings).filter(([, tabId]) => tabId !== message.tabId));
      await chrome.storage.local.set({ bindings: next });
      respond({ ok: true, bindings: next });
    })().catch((error) => respond({ error: error.message }));
    return true;
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { bindings } = await settings();
  const next = Object.fromEntries(Object.entries(bindings).filter(([, boundTab]) => boundTab !== tabId));
  if (Object.keys(next).length !== Object.keys(bindings).length) await chrome.storage.local.set({ bindings: next });
});

connect();
