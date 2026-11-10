import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveConfig } from '../core/config.mjs';

function tempRuntime(t, saved = undefined) {
  const home = mkdtempSync(join(tmpdir(), 'chat-gateway-event-config-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const dir = join(home, 'config');
  mkdirSync(dir);
  const file = join(dir, 'runtime.json');
  if (saved) writeFileSync(file, JSON.stringify(saved));
  return { home, dir, file };
}

test('Chat Gateway defaults to the same Relay subject as Events Bus, without Neo env settings', t => {
  const {home, dir}=tempRuntime(t);
  const config=resolveConfig({home, env:{EVENTS_BUS_DATA_DIR:dir,
    NEO_NATS_URL:'nats://legacy:4555',NEO_EVENTS_SUBJECT_PREFIX:'other.events.job'}});
  assert.equal(config.subjectPrefix,'relay.events.job');
  assert.equal(config.subject,'relay.events.job.*.job.runtime_status.changed');
  assert.equal(config.natsUrl,'nats://127.0.0.1:4222');
});

test('Chat Gateway honors Events Bus config path and explicit connection/subject', t => {
  const {home, file}=tempRuntime(t,{natsUrl:'nats://localhost:5222',subjectPrefix:'custom.events'});
  const config=resolveConfig({home,env:{EVENTS_BUS_CONFIG:file}});
  assert.equal(config.subjectPrefix,'custom.events');
  assert.equal(config.natsUrl,'nats://localhost:5222');
  const override=resolveConfig({home,env:{EVENTS_BUS_CONFIG:file,EVENTS_BUS_NATS_URL:'nats://127.0.0.1:4222',EVENTS_BUS_SUBJECT_PREFIX:'relay.events.job'}});
  assert.equal(override.subject,'relay.events.job.*.job.runtime_status.changed');
  assert.equal(override.natsUrl,'nats://127.0.0.1:4222');
});

test('Chat Gateway refuses an unmigrated Events Bus namespace', t => {
  const {home, file}=tempRuntime(t,{subjectPrefix:'neo.events.job'});
  assert.throws(()=>resolveConfig({home,env:{EVENTS_BUS_CONFIG:file}}),/coordinate migration/);
  assert.equal(resolveConfig({home,env:{EVENTS_BUS_CONFIG:file,EVENTS_BUS_SUBJECT_PREFIX:'relay.events.job'}}).subjectPrefix,'relay.events.job');
});


test('Chat Gateway refuses malformed saved Events Bus config rather than splitting namespaces', t => {
  const {home, file}=tempRuntime(t);
  for (const payload of ['{corrupt','[]','null']) {
    writeFileSync(file,payload);
    assert.throws(()=>resolveConfig({home,env:{EVENTS_BUS_CONFIG:file}}),/Cannot load|must be an object/);
  }
});
