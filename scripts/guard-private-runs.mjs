#!/usr/bin/env node
// Fail closed if any private Neo Project Run path enters the public monorepo.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const privateRun = path => /(^|\/)runs\//.test(path);
function git(args, stdin) {
  const result = spawnSync('git', args, { encoding: 'utf8', input: stdin,
    maxBuffer: 32 * 1024 * 1024, timeout: 60000 });
  if (result.error || result.status !== 0)
    throw new Error(`git ${args[0]} failed: ${result.stderr || result.error}`);
  return result.stdout;
}
function reject(paths, where) {
  const found = paths.filter(privateRun);
  if (!found.length) return;
  process.stderr.write(`BLOCKED: private runs/ in ${where}:\n${found.slice(0, 12).join('\n')}\n`);
  process.exit(1);
}

try {
  // Index protection includes force-added paths. gitignore is not a security gate.
  reject(git(['ls-files', '--cached', '-z']).split('\0').filter(Boolean), 'Git index');
  reject(git(['ls-tree', '-r', '--name-only', 'HEAD']).split('\n').filter(Boolean), 'HEAD');

  if (process.argv.includes('--push')) {
    const updates = readFileSync(0, 'utf8').trim().split('\n').filter(Boolean);
    for (const update of updates) {
      const fields = update.trim().split(/\s+/);
      if (fields.length !== 4) throw new Error('invalid pre-push ref update');
      const local = fields[1], remote = fields[3];
      if (!/^[a-f0-9]{40,64}$/i.test(local) || !/^[a-f0-9]{40,64}$/i.test(remote))
        throw new Error('invalid pre-push SHA');
      if (/^0+$/.test(local)) continue; // Deleting a remote ref cannot leak new objects.
      const range = /^0+$/.test(remote) ? [local] : [local, '^' + remote];
      const commits = git(['rev-list', ...range]).trim();
      if (!commits) continue;
      // Scan every outgoing commit, not only the destination tree. A private
      // file added and then removed must still block pushing its Git object.
      const changed = git(['diff-tree', '--stdin', '--root', '--no-commit-id', '--name-only', '-r'],
        commits + '\n').split('\n').filter(Boolean);
      reject(changed, 'outgoing Git history');
    }
  }
} catch (error) {
  process.stderr.write(`BLOCKED: Git privacy verification failed: ${error.message}\n`);
  process.exit(1);
}
