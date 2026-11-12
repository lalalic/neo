import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const cli = resolve(import.meta.dirname, '../.bin/neo.mjs');

test('independent local-only Neo Project resolves and dry-runs without any GitHub remote', () => {
  const root = mkdtempSync(join(tmpdir(), 'neo-independent-project-'));
  try {
    const workspaceRoot = join(root, 'workspace');
    const projectsRoot = join(workspaceRoot, 'neo-projects');
    const project = join(projectsRoot, 'vlog');
    mkdirSync(project, { recursive: true });
    execFileSync('git', ['init', '-q', project]);
    writeFileSync(join(project, 'AGENTS.md'), 'Local project');
    writeFileSync(join(project, 'README.md'), 'Independent project');
    writeFileSync(join(project, 'graph.mmd'), 'flowchart TD\nA[agent:test]');
    writeFileSync(join(project, 'project.run.json'), JSON.stringify({ schemaVersion: 1, input: { type: 'url', schemes: ['https'] } }));
    const configPath = join(root, 'config.json');
    writeFileSync(configPath, JSON.stringify({ schemaVersion: 1, neoRoot: projectsRoot }));
    const env = { ...process.env, NEO_WORKSPACE_CONFIG: configPath, NEO_ROOT: projectsRoot };
    const info = JSON.parse(execFileSync(process.execPath, [cli, 'project', 'resolve', 'vlog'], { env, encoding: 'utf8' }));
    assert.equal(info.git_root, realpathSync(project));
    assert.equal(info.local_path, realpathSync(project));
    assert.equal(info.neo_project, true);
    assert.equal(info.repo, 'vlog');
    const denied = execFileSync(process.execPath, [cli, 'project', 'list'], { env, encoding: 'utf8' });
    assert.equal(JSON.parse(denied).every(item => item.neo_project === true), true);
    const output = JSON.parse(execFileSync(process.execPath, [cli, 'project', 'run', '--dry-run', '--project', 'vlog', '--url', 'https://example.test/item'], { env, encoding: 'utf8' }));
    assert.equal(output.dryRun, true);
    assert.ok(output.runPath.startsWith(join(realpathSync(project), 'runs')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
