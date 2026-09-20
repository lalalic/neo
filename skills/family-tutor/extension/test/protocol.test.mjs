import assert from 'node:assert/strict';
import test from 'node:test';

import { bindChild, isChatGptUrl, normalizeBridgeUrl, validateTurn } from '../protocol.mjs';

test('binding keeps one child per tab and one tab per child', () => {
  const bindings = bindChild({ alice: 1, bob: 2 }, 'carol', 2);
  assert.deepEqual(bindings, { alice: 1, carol: 2 });
  assert.deepEqual(bindChild(bindings, 'alice', 3), { carol: 2, alice: 3 });
});

test('bridge and tab URLs stay on allowed hosts', () => {
  assert.equal(normalizeBridgeUrl('ws://127.0.0.1:8787/ws'), 'ws://127.0.0.1:8787/ws');
  assert.throws(() => normalizeBridgeUrl('wss://example.com/ws'), /loopback/);
  assert.equal(isChatGptUrl('https://chatgpt.com/c/123'), true);
  assert.equal(isChatGptUrl('https://example.com/chatgpt.com'), false);
});

test('turn validation accepts only correlated loopback image turns', () => {
  const turn = validateTurn({
    type: 'turn',
    childId: 'kid-a',
    prompt: 'What is in this photo?',
    correlation: { correlationId: 'turn-1' },
    attachments: [{ url: 'http://127.0.0.1:8787/blobs/1', token: 'secret', name: 'photo.jpg', mimeType: 'image/jpeg' }],
  });
  assert.equal(turn.childId, 'kid-a');
  assert.equal(turn.attachments.length, 1);
  assert.throws(() => validateTurn({ type: 'turn', childId: 'kid-a', prompt: '', correlation: { correlationId: 'x' }, attachments: [{ url: 'https://example.com/x', mimeType: 'image/jpeg' }] }), /loopback/);
  assert.throws(() => validateTurn({ type: 'turn', childId: 'kid-a', prompt: '', correlation: { correlationId: 'x' }, attachments: [{ url: 'http://127.0.0.1/x', mimeType: 'application/pdf' }] }), /image/);
});
