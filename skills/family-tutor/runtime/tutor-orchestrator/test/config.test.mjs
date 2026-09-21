import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.mjs';

function load(children) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'family-tutor-config-'));
  const file = path.join(dir, 'family.config.json');
  fs.writeFileSync(file, JSON.stringify({
    version: 1,
    browserBridge: { enabled: true, host: '127.0.0.1', port: 43117 },
    discord: { parentChannelId: 'parents' },
    parents: [{ id: 'p1', role: 'parent' }],
    children,
  }));
  try { return loadConfig(file); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('accepts canonical child-name config without routing mappings', () => {
  assert.equal(load([{ id: 'sammy', name: 'Sammy' }]).children[0].id, 'sammy');
});

for (const key of ['alias', 'aliases', 'channelId', 'discordChannelId', 'project']) {
  test(`rejects legacy child ${key} mapping`, () => {
    assert.throws(() => load([{ id: 'sammy', name: 'Sammy', [key]: key === 'aliases' ? ['sam'] : 'legacy' }]), /sole routing key/);
  });
}
