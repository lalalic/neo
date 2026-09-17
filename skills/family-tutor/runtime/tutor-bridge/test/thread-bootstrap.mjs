import assert from 'node:assert/strict';
import { bootstrapPrompt, memoryBlock, turnPrompt } from '../src/prompts.mjs';

const memory = 'Current focus: fractions';
const child = { name: 'Kid 1' };
const message = 'Can you check my work?';

assert.equal(bootstrapPrompt(child, message, memory), `${memoryBlock(memory)}\n\nStudent message:\n${message}`);
assert.equal(turnPrompt(message), `Student message:\n${message}`);
assert.ok(!turnPrompt(message).includes('LOCAL LEARNER MEMORY'));

console.log('family tutor thread bootstrap test passed');
