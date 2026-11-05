import { existsSync, readdirSync, readSync, openSync, closeSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

function metadata(file) {
  const fd = openSync(file, 'r');
  try {
    const bytes = Buffer.alloc(16384);
    const size = readSync(fd, bytes, 0, bytes.length, 0);
    const start = bytes.toString('utf8', 0, size);
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(start);
    if (!match) return {};
    const values = {};
    for (const line of match[1].split(/\r?\n/)) {
      const field = /^(name|description|type|extends):\s*(.*?)\s*$/.exec(line);
      if (!field) continue;
      let value = field[2];
      if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1).replaceAll("''", "'");
      else if (value.startsWith('"') && value.endsWith('"')) {
        try { value = JSON.parse(value); } catch { value = value.slice(1, -1); }
      }
      if (value && value !== '>' && value !== '|') values[field[1]] = value;
    }
    return values;
  } finally { closeSync(fd); }
}

function filesIn(directory, namePattern) {
  if (!existsSync(directory)) return [];
  if (!statSync(directory).isDirectory()) throw new Error(`not a directory: ${directory}`);
  return readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && namePattern.test(entry.name))
    .map(entry => join(directory, entry.name));
}

function scanAgentDirectory(directory, source) {
  return filesIn(directory, /\.agent\.md$/).map(file => {
    const info = metadata(file);
    return {
      name: info.name || basename(file, '.agent.md'),
      description: info.description || '',
      source,
      path: file,
      ...(info.type ? { type: info.type } : {}),
      ...(info.extends ? { extends: info.extends } : {}),
      requires_project_manifest: false,
    };
  });
}

function scanAgencyDirectory(directory) {
  if (!existsSync(directory)) throw new Error(`Agency Agents library unavailable: ${directory}; recover using Neo's agency-agents setup.sh`);
  return readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name.startsWith('agency-'))
    .flatMap(entry => {
      const file = join(directory, entry.name, 'SKILL.md');
      if (!existsSync(file)) return [];
      const info = metadata(file);
      return [{
        name: info.name || entry.name,
        description: info.description || '',
        source: 'agency',
        path: file,
        requires_project_manifest: true,
      }];
    });
}

function projectFromCwd(cwd, neoRoot) {
  let current = resolve(cwd);
  while (current !== dirname(current)) {
    if (current === neoRoot) break;
    if (existsSync(join(current, 'AGENTS.md')) && existsSync(join(current, 'README.md'))) return current;
    current = dirname(current);
  }
  return null;
}

export function listAgentDefinitions(options = {}) {
  const neoRoot = resolve(options.neoRoot ?? join(homedir(), 'Workspace', 'neo'));
  const home = options.home ?? homedir();
  const agencyDirectory = options.agencyDirectory ?? join(home, '.local/share/agency-agents/integrations/dsh');
  const project = options.project ? resolve(options.project)
    : projectFromCwd(options.cwd ?? process.cwd(), neoRoot);
  if (project && (!existsSync(project) || !statSync(project).isDirectory())) throw new Error(`invalid project directory: ${project}`);
  const items = [
    ...(project && project !== neoRoot ? scanAgentDirectory(join(project, 'agents'), 'project') : []),
    ...scanAgentDirectory(join(home, '.agents/agents'), 'global'),
    ...scanAgentDirectory(join(neoRoot, 'agents'), 'shared'),
    ...scanAgencyDirectory(agencyDirectory),
  ];
  // Keep shadowed definitions visible, but flag the effective name binding.
  const seen = new Set();
  return items.map(item => {
    const key = item.name.toLowerCase();
    const effective = !seen.has(key);
    seen.add(key);
    return { ...item, effective };
  }).sort((a, b) => a.name.localeCompare(b.name) || a.source.localeCompare(b.source));
}

export function searchAgentDefinitions(items, query, limit = 10) {
  const phrase = query.toLowerCase().trim();
  if (!phrase) throw new Error('agent search requires a query');
  const words = phrase.match(/[\p{L}\p{N}]+/gu) ?? [];
  return items.map(item => {
    const name = item.name.toLowerCase();
    const description = item.description.toLowerCase();
    let score = name === phrase ? 100 : name.includes(phrase) ? 50 : description.includes(phrase) ? 25 : 0;
    for (const word of words) {
      if (name.includes(word)) score += 10;
      else if (description.includes(word)) score += 3;
    }
    return { item, score };
  }).filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score || Number(b.item.effective) - Number(a.item.effective) || a.item.name.localeCompare(b.item.name))
    .slice(0, limit).map(entry => entry.item);
}

export function runAgentDiscovery(argv, options = {}) {
  const [operation, ...args] = argv;
  const usage = 'usage: neo agent list [--project PATH] [--source project|shared|global|agency] | search QUERY [--project PATH] [--source ...] [--limit N]';
  if (!['list', 'search'].includes(operation)) throw new Error(usage);
  let project;
  let source;
  let limit = 10;
  const queryWords = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (['--project', '--source', '--limit'].includes(arg)) {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      if (arg === '--project') project = value;
      if (arg === '--source') source = value;
      if (arg === '--limit') {
        limit = Number(value);
        if (!Number.isInteger(limit) || limit < 1 || limit > 283) throw new Error('--limit must be an integer from 1 to 283');
      }
    } else if (arg.startsWith('-')) throw new Error(usage);
    else queryWords.push(arg);
  }
  if (source && !['project', 'shared', 'global', 'agency'].includes(source)) throw new Error('invalid --source');
  if (operation === 'list' && (queryWords.length || args.includes('--limit'))) throw new Error(usage);
  if (operation === 'search' && queryWords.length === 0) throw new Error(usage);
  const items = listAgentDefinitions({ ...options, ...(project ? { project } : {}) });
  const filtered = source ? items.filter(item => item.source === source) : items;
  const result = operation === 'search' ? searchAgentDefinitions(filtered, queryWords.join(' '), limit) : filtered;
  return result;
}
