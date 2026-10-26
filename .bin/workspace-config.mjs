import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

export function loadWorkspaceConfig({ configPath = process.env.NEO_WORKSPACE_CONFIG ?? join(homedir(), '.config/neo/workspace.json') } = {}) {
  let config;
  try {
    config = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      const workspaceRoot = resolve(homedir(), 'Workspace');
      return { schemaVersion: 1, workspaceRoot, neoRoot: join(workspaceRoot, 'neo') };
    }
    throw new Error(`Cannot read workspace configuration: ${error.message}`);
  }
  if (config?.schemaVersion !== 1 || typeof config.workspaceRoot !== 'string' || !isAbsolute(config.workspaceRoot)) {
    throw new Error(`Invalid workspace configuration at ${configPath}`);
  }
  const workspaceRoot = resolve(config.workspaceRoot);
  try {
    if (!statSync(workspaceRoot).isDirectory()) throw new Error('not a directory');
  } catch {
    throw new Error(`Configured Workspace Root is not an accessible directory: ${workspaceRoot}`);
  }
  return { schemaVersion: 1, workspaceRoot, neoRoot: join(workspaceRoot, 'neo') };
}
