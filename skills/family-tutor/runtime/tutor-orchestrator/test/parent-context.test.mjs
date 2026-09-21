import test from 'node:test';
import assert from 'node:assert/strict';
import { buildParentContextPrompt, childProjectName, parseParentMessage, renderParentNaturalText, validateChildChannel } from '../src/parent-context.mjs';
test('parses natural parent mentions anywhere and supports later no-mention messages', () => {
  const parsed = parseParentMessage('Could <#111> and <#222> review this week\'s plan?');
  assert.deepEqual(parsed.channelMentionIds, ['111', '222']);
  assert.equal(renderParentNaturalText(parsed.value, { 111: 'sammy', 222: 'maggie' }), 'Could sammy and maggie review this week\'s plan?');
  assert.deepEqual(parseParentMessage('How is progress?').channelMentionIds, []);
});
test('keeps exact channel name to Project binding', () => {
  const child = { id: 'sammy', name: 'Sammy' };
  assert.equal(childProjectName('sammy'), 'neo/family-tutor/sammy');
  assert.deepEqual(validateChildChannel(child, { name: 'sammy' }), { childId: 'sammy', project: 'neo/family-tutor/sammy' });
  assert.throws(() => validateChildChannel(child, { name: 'Sammy' }), /must match child id/);
});
test('marks parent requests as privacy-filtered context in the same child thread', () => {
  const prompt = buildParentContextPrompt({ child: { id: 'sammy', name: 'Sammy' }, command: 'parent-query', value: 'how is progress?', authorId: 'p1', messageId: 'm1' });
  assert.match(prompt, /existing persistent ChatGPT Project thread/);
  assert.match(prompt, /privacy-filtered learning summary/);
  assert.match(prompt, /AGENTS\.md/);
});
