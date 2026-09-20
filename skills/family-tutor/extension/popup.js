const child = document.querySelector('#child');
const bridge = document.querySelector('#bridge');
const token = document.querySelector('#token');
const status = document.querySelector('#status');

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const current = await chrome.runtime.sendMessage({ type: 'settings.get' });
if (current.bridgeUrl) bridge.value = current.bridgeUrl;
const boundChild = Object.entries(current.bindings || {}).find(([, tabId]) => tabId === tab?.id)?.[0];
if (boundChild) child.value = boundChild;
status.textContent = boundChild ? `Bound to ${boundChild}` : 'This tab is not bound.';

document.querySelector('#bind').addEventListener('click', async () => {
  const result = await chrome.runtime.sendMessage({
    type: 'bind.current',
    tabId: tab?.id,
    childId: child.value,
    bridgeUrl: bridge.value,
    token: token.value,
  });
  status.textContent = result.error || `Bound this tab to ${child.value.trim()}.`;
  token.value = '';
});

document.querySelector('#unbind').addEventListener('click', async () => {
  const result = await chrome.runtime.sendMessage({ type: 'unbind.current', tabId: tab?.id });
  status.textContent = result.error || 'This tab is not bound.';
});
