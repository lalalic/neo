import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const skillDir = join(repo, 'skills/neo-project');
const references = ['project-contract.md', 'run-contract.md', 'harness-integration.md', 'worker-evals.md'];
const read = (file) => readFileSync(file, 'utf8');

test('one discoverable Neo Project Skill owns its project contracts and routes references on demand', () => {
  const root = read(join(skillDir, 'SKILL.md'));
  assert.match(root, /^name: neo-project$/m);
  for (const name of references) {
    const file = join(skillDir, 'references', name);
    assert.ok(existsSync(file), `missing ${name}`);
    assert.ok(root.includes(`references/${name}`), `undiscoverable reference ${name}`);
    assert.ok(read(file).length > 300, `empty project knowledge ${name}`);
  }
  for (const old of ['neo-project-run-contract.md', 'neo-harness-project-layout.md', 'project-worker-prompt-evals.md']) {
    assert.ok(!existsSync(join(repo, 'docs', old)), `obsolete canonical docs/${old}`);
  }
});

test('all Neo Project Skill local Markdown links resolve after relocation', () => {
  const sources = [
    'SKILL.md',
    ...references.map((name) => `references/${name}`),
    'evals/cases.md',
    'recipes/product-prototype.md',
  ];
  for (const source of sources) {
    const file = join(skillDir, source);
    const markdown = read(file);
    const localLinks = [...markdown.matchAll(/\]\(([^)]+)\)/g)].map((match) => match[1]);
    for (const link of localLinks) {
      if (/^(?:https?:|#|mailto:)/.test(link)) continue;
      const target = resolve(dirname(file), decodeURIComponent(link.split('#', 1)[0]));
      assert.ok(existsSync(target), `${source}: broken local link ${link}`);
    }
  }
});

test('Harness entry points refer to canonical Skill rather than deleted Project docs', () => {
  for (const relative of ['README.md', 'AGENTS.md', 'specs/001-neo-project-run/plan.md', 'specs/001-neo-project-run/tasks.md']) {
    const s = read(join(repo, relative));
    assert.doesNotMatch(s, /docs\/(neo-project-run-contract|neo-harness-project-layout|project-worker-prompt-evals)\.md/);
    assert.match(s, /skills\/neo-project\//);
  }
});


test('installed Neo CLI distribution includes all Project reference contracts', () => {
  const temp = mkdtempSync(join(tmpdir(), 'neo-project-skill-package-'));
  try {
    const dst = join(temp, 'dist');
    execFileSync(process.execPath, [join(repo, 'scripts/stage-neo-cli.mjs'), dst], { stdio: 'pipe' });
    for (const path of ['SKILL.md', ...references.map(name => `references/${name}`), 'recipes/product-prototype.md', 'evals/cases.md']) {
      assert.ok(existsSync(join(dst, 'skills/neo-project', path)), `packaged Skill is missing ${path}`);
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
