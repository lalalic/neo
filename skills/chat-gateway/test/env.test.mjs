import test from 'node:test';
import assert from 'node:assert/strict';
import { createEnvStore, resolveEnvironment } from '../core/env.mjs';
import { files } from '../core/files.mjs';
import { fixture } from './helpers.mjs';

const localDate = (day, hour, minute = 0) => new Date(2026, 10, day, hour, minute);

test('weekday boundaries are 08:00 inclusive, 18:00 exclusive; weekend home', () => {
  assert.equal(resolveEnvironment({ now: localDate(9, 7, 59) }).mode, 'home');
  assert.equal(resolveEnvironment({ now: localDate(9, 8) }).mode, 'office');
  assert.equal(resolveEnvironment({ now: localDate(9, 17, 59) }).mode, 'office');
  assert.equal(resolveEnvironment({ now: localDate(9, 18) }).mode, 'home');
  assert.equal(resolveEnvironment({ now: localDate(8, 12) }).mode, 'home');
  assert.equal(resolveEnvironment({ now: localDate(7, 12) }).mode, 'home');
});

test('override beats observed which beats heuristic; clearing returns heuristic', async (t) => {
  const { dir } = await fixture(t);
  let now = localDate(9, 9);
  const store = createEnvStore({ dir, files, now: () => now });
  assert.equal((await store.resolve()).mode, 'office');
  await store.setOverride('home');
  const override = await store.resolve();
  assert.equal(override.mode, 'home');
  assert.equal(override.source, 'override');
  assert.equal(override.since, now.toISOString());
  assert.equal(override.phone.channel, 'unknown');
  const observed = resolveEnvironment({ observed: { mode: 'office', phoneChannel: 'wifi' },
    override: { mode: 'home' }, now });
  assert.equal(observed.mode, 'home');
  assert.equal(observed.phone.channel, 'wifi');
  assert.equal(resolveEnvironment({ observed: { mode: 'home' }, now }).source, 'observed');
  await store.setOverride('auto');
  assert.equal((await store.resolve()).source, 'heuristic');
  now = localDate(8, 13);
  assert.equal((await store.resolve()).mode, 'home');
});
