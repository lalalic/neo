import { readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The Harness installation is independent of the user-selected Neo Projects root.
const harnessRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export function loadWorkspaceConfig({ configPath = process.env.NEO_WORKSPACE_CONFIG ?? join(homedir(), '.config/neo/workspace.json') } = {}) {
  let config;
  try { config = JSON.parse(readFileSync(configPath, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`Cannot read Neo configuration: ${error.message}`);
    config = { schemaVersion: 1, neoRoot: join(homedir(), 'Workspace') };
  }
  if (!config || config.schemaVersion !== 1 ||
      Object.keys(config).length !== 2 ||
      Object.keys(config).some(key => !['schemaVersion', 'neoRoot'].includes(key)))
    throw new Error(`Invalid Neo configuration at ${configPath}`);
  const chosen = process.env.NEO_ROOT ?? config.neoRoot ?? join(homedir(), 'Workspace');
  if (typeof chosen !== 'string' || !isAbsolute(chosen)) throw new Error('NEO_ROOT must be an absolute path');
  const path = resolve(chosen);
  let neoRoot;
  try {
    if (!statSync(path).isDirectory()) throw new Error('not a directory');
    neoRoot = realpathSync(path);
  } catch { throw new Error(`NEO_ROOT is not an accessible directory: ${path}`); }
  return { schemaVersion: 1, neoRoot, harnessRoot };
}
