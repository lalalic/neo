import test from 'node:test';
import assert from 'node:assert/strict';
import { buildXChatBootstrap, renderXChatBootstrap } from '../.bin/xchat-bootstrap.mjs';

const workspace = { workspaceRoot: '/workspace', neoRoot: '/workspace/neo' };
const files = new Map([
  ['/home/.agents/AGENTS.md', 'Agent rules for local workers'],
  ['/workspace/neo/skills/xchat-orchestrator/xchat-bootstrap.md', 'XChat harness rules'],
]);
const skillRows = [
  { name: 'markcut', description: 'Video review', path: '/skills/markcut/SKILL.md' },
  { name: 'missing', description: 'Needs dependencies', path: '/skills/missing/SKILL.md',
    requires_resolved: false, missing_required_skills: ['webhelm'] },
];

function build(overrides = {}) {
  return buildXChatBootstrap({
    workspace, home: '/home', readFile: file => files.get(file),
    executeControl: (args, callbacks) => {
      assert.deepEqual(args.slice(0, 2), ['skill', 'list']);
      callbacks.emit(JSON.stringify(skillRows));
      return 0;
    },
    ...overrides,
  });
}
test('XChat combines canonical agent rules and dynamic discovered skill metadata', () => {
  const result = build();
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.agentRules, 'Agent rules for local workers');
  assert.equal(result.bootstrap, 'XChat harness rules');
  assert.equal(result.skills.length, 2);
  assert.equal(result.skills[1].available, false);
  const markdown = renderXChatBootstrap(result);
  assert.match(markdown, /markcut/);
  assert.match(markdown, /\/skills\/markcut\/SKILL.md/);
  assert.doesNotMatch(markdown, /tools\/list|shell, fs, computer/);
});
test('project-specific discovery is only used when selected', () => {
  const result = build({ project: '/workspace/foo', executeControl: (args, callbacks) => {
    assert.deepEqual(args, ['skill', 'list', '--project', '/workspace/foo']);
    callbacks.emit('[]');
    return 0;
  } });
  assert.deepEqual(result.skills, []);
});
test('bad catalog and unavailable instructions fail closed', () => {
  assert.throws(() => build({ readFile: () => undefined }), /Agent rules is empty/);
  assert.throws(() => build({ executeControl: (args, cb) => { cb.emit('{'); return 0; } }), /invalid JSON/);
  assert.throws(() => build({ executeControl: () => 2 }), /neo skill list failed/);
  assert.throws(() => build({ executeControl: (args, cb) => {
    cb.emit('[{"name":"bad","description":"bad","path":"relative"}]'); return 0;
  } }), /invalid skill record/);
});
