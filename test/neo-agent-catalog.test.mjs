import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { listAgentDefinitions, searchAgentDefinitions, runAgentDiscovery } from '../.bin/neo-agent-catalog.mjs';

function fixture(callback) {
  const root = mkdtempSync(join(tmpdir(), 'neo-agent-catalog-'));
  const neoRoot = join(root, 'neo');
  const home = join(root, 'home');
  const project = join(root, 'project');
  const agencyDirectory = join(home, '.local/share/agency-agents/integrations/dsh');
  const put = (file, content) => { mkdirSync(file.slice(0, file.lastIndexOf('/')), { recursive: true }); writeFileSync(file, content); };
  try {
    put(join(neoRoot, 'agents/reviewer.agent.md'), "---\nname: reviewer\ndescription: Shared code reviewer\n---\n");
    put(join(project, 'agents/reviewer.agent.md'), "---\nname: reviewer\ndescription: Project-specific reviewer\n---\n");
    put(join(project, 'AGENTS.md'), '# Project');
    put(join(project, 'README.md'), '# Project');
    put(join(agencyDirectory, 'agency-code-reviewer/SKILL.md'), "---\nname: 'agency-code-reviewer'\ndescription: 'Expert code review specialist'\n---\n# Details\n");
    put(join(agencyDirectory, 'agency-product-strategist/SKILL.md'), "---\nname: agency-product-strategist\ndescription: Product research and strategy\n---\n");
    callback({ root, neoRoot, home, project, agencyDirectory });
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test('project context discovers project, shared and agency definitions without loading bodies', () => fixture(options => {
  const { project: ignored, ...base } = options;
  const rows = listAgentDefinitions({ ...base, cwd: join(options.project, 'agents') });
  assert.equal(rows.length, 4);
  assert.equal(rows.find(item => item.source === 'project').name, 'reviewer');
  assert.equal(rows.find(item => item.source === 'project').effective, true);
  assert.equal(rows.find(item => item.source === 'shared').effective, false);
  assert.equal(rows.filter(item => item.source === 'agency').length, 2);
  assert.ok(rows.every(item => item.path.startsWith(options.root)));
  assert.ok(rows.find(item => item.name === 'agency-code-reviewer').requires_project_manifest);
}));

test('outside a project, no project-specific agents are exposed', () => fixture(options => {
  const { project: ignored, ...base } = options;
  const rows = listAgentDefinitions({ ...base, cwd: options.root });
  assert.equal(rows.length, 3);
  assert.equal(rows.find(item => item.name === 'reviewer').effective, true);
}));

test('keyword discovery ranks intent and supports filtering, limits and explicit project paths', () => fixture(options => {
  const rows = listAgentDefinitions({ ...options, project: options.project });
  const found = searchAgentDefinitions(rows, 'code review', 1);
  assert.equal(found.length, 1);
  assert.equal(found[0].name, 'agency-code-reviewer');
  const result = runAgentDiscovery(['search', 'code', 'review', '--project', options.project, '--source', 'agency', '--limit', '1'], options);
  assert.equal(result.length, 1);
  assert.equal(result[0].source, 'agency');
  assert.equal(runAgentDiscovery(['list', '--source', 'project', '--project', options.project], options).length, 1);
  assert.throws(() => runAgentDiscovery(['search'], options), /usage/);
  assert.throws(() => runAgentDiscovery(['list', '--limit', '1'], options), /usage/);
  assert.throws(() => runAgentDiscovery(['list', '--source', 'unknown'], options), /invalid/);
}));

test('missing Agency Agents library is a clear failure, not an empty valid catalog', () => fixture(options => {
  assert.throws(() => listAgentDefinitions({ ...options, agencyDirectory: join(options.root, 'missing') }), /Agency Agents library unavailable/);
}));


test('staged Neo CLI bundles agent discovery and existing TTS dependency', () => {
  const root = new URL('../', import.meta.url).pathname;
  const dest = mkdtempSync(join(tmpdir(), 'neo-agent-dist-'));
  try {
    execFileSync(process.execPath, [join(root, 'scripts/stage-neo-cli.mjs'), dest], { timeout: 15000 });
    const help = execFileSync(process.execPath, [join(dest, '.bin/neo.mjs'), '--help'], { encoding: 'utf8', timeout: 15000 });
    assert.match(help, /neo agent list/);
    assert.match(help, /neo agent search/);
  } finally { rmSync(dest, { recursive: true, force: true }); }
});
