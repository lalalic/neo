import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTutorPrompt, buildVoiceAttachmentPrompt } from '../src/prompt.mjs';
test('voice prompt explicitly delegates transcription to ChatGPT audio handling', () => {
  const prompt = buildVoiceAttachmentPrompt('help me with this', [{ name: 'voice.ogg' }]);
  assert.match(prompt, /speech\/voice message attachment/);
  assert.match(prompt, /multimodal audio understanding/);
  assert.match(prompt, /Do not judge.*grammar/);
});
test('tutor prompt keeps AGENTS.md as the only durable memory', () => {
  const prompt = buildTutorPrompt('sammy', '# Memory', 'hello', [{ name: 'voice.ogg', mimeType: 'audio/ogg' }]);
  assert.match(prompt, /AGENTS\.md is the only durable/);
  assert.match(prompt, /voice\.ogg/);
});
