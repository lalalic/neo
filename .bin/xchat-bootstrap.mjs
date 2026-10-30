import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadWorkspaceConfig } from './workspace-config.mjs';
import { executeControl } from './neo-control.mjs';

function requiredFile(file, name, read = fs.readFileSync) {
  const content = read(file, 'utf8');
  if (typeof content !== 'string' || !content.trim()) throw new Error(`${name} is empty: ${file}`);
  return content.trim();
}

export function buildXChatBootstrap(options = {}) {
  const workspace = options.workspace ?? loadWorkspaceConfig();
  const read = options.readFile ?? fs.readFileSync;
  const home = options.home ?? os.homedir();
  const agentsPath = path.join(home, '.agents', 'AGENTS.md');
  const bootstrapPath = path.join(workspace.neoRoot, 'skills/xchat-orchestrator/xchat-bootstrap.md');
  const agentRules = requiredFile(agentsPath, 'Agent rules', read);
  const bootstrap = requiredFile(bootstrapPath, 'XChat bootstrap', read);

  // Reuse the canonical installed Neo skill resolver. Never invent a second registry.
  let output = '';
  let errors = '';
  const run = options.executeControl ?? executeControl;
  const args = ['skill', 'list'];
  if (options.project) args.push('--project', options.project);
  const status = run(args, {
    emit: text => { output += text; },
    error: text => { errors += text; },
  });
  if (status !== 0) throw new Error(`neo skill list failed: ${errors.trim() || status}`);

  let rows;
  try { rows = JSON.parse(output); }
  catch { throw new Error('neo skill list returned invalid JSON'); }
  if (!Array.isArray(rows)) throw new Error('neo skill list did not return an array');
  const skills = rows.map(row => {
    if (!row || typeof row.name !== 'string' || typeof row.description !== 'string'
        || typeof row.path !== 'string' || !path.isAbsolute(row.path)) {
      throw new Error('neo skill list returned an invalid skill record');
    }
    return {
      name: row.name,
      description: row.description,
      // Keep the historical JSON path field for existing consumers, while
      // exposing the explicit absolutePath name used by the harness catalog.
      absolutePath: row.path,
      path: row.path,
      available: row.requires_resolved !== false,
      ...(row.missing_required_skills?.length ? { missing_required_skills: row.missing_required_skills } : {}),
    };
  });
  return { schemaVersion: 1, agentRules, bootstrap, skills };
}

export function renderXChatBootstrap(manifest) {
  const lines = [
    '# XChat Harness Bootstrap',
    '',
    'The following local agent rules and XChat bootstrap are authoritative for this session.',
    'This is a dynamic snapshot; discover and load only task-relevant SKILL.md files.',
    'MCP already provides tools. This manifest does not duplicate MCP tool inventory.',
    '',
    '## Local Agent Rules',
    '',
    manifest.agentRules,
    '',
    '## XChat Bootstrap',
    '',
    manifest.bootstrap,
    '',
    '## Discovered Skills',
    '',
    'The following catalog was discovered dynamically through neo skill list.',
    'Each entry includes name, description, and absolutePath (the SKILL.md file to load on demand).',
    '',
  ];
  for (const skill of manifest.skills) {
    const description = skill.description.replace(/\s+/g, ' ').trim();
    lines.push(`- name: \`${skill.name}\``);
    lines.push(`  description: ${description}`);
    lines.push(`  absolutePath: \`${skill.absolutePath}\``);
    if (!skill.available) {
      lines.push(`  available: false (missing prerequisites: ${(skill.missing_required_skills ?? []).join(', ') || 'unknown'})`);
    }
  }
  return lines.join('\n') + '\n';
}
