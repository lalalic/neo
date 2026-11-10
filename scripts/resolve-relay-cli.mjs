/** Locate Relay without requiring a Neo source checkout or a hardcoded host path. */
import { existsSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, isAbsolute, join, resolve } from 'node:path';

export function resolveRelayCli(harnessRoot) {
  const requested = process.env.AGENTS_RELAY_DIST_CLI;
  if (requested !== undefined) {
    if (!isAbsolute(requested) || !existsSync(requested))
      throw new Error(`Relay PromptBuilder CLI unavailable: ${requested}; provide a valid absolute AGENTS_RELAY_DIST_CLI`);
    return realpathSync(requested);
  }
  const sibling = resolve(harnessRoot, '../agents-relay/dist/cli.js');
  if (existsSync(sibling)) return realpathSync(sibling);
  const found = spawnSync('which', ['agents-relay'], { encoding: 'utf8', timeout: 5000 });
  if (found.status === 0 && found.stdout?.trim()) {
    const cli = found.stdout.trim().split('\n')[0];
    if (isAbsolute(cli) && existsSync(cli)) return realpathSync(cli);
  }
  throw new Error('Relay PromptBuilder CLI unavailable: install agents-relay or configure AGENTS_RELAY_DIST_CLI');
}

export function resolveRelayGraphParser(harnessRoot) {
  const parser = join(dirname(resolveRelayCli(harnessRoot)), 'agent-graph.js');
  if (!existsSync(parser)) throw new Error(`Relay Agent Graph parser unavailable: ${parser}`);
  return parser;
}
