import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, readFileSync, realpathSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';

const fail = message => { throw new Error(`Run Git: ${message}`); };
const inside = (root, path) => {
  const rel = relative(root, path);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
};

/** Neo's global policy for every private Run Git, independent of project
 * run-template/.gitignore. Git's info/exclude is local and never committed.
 */
export function ensureRunGlobalExcludes(run) {
  const path=join(run,'.git','info','exclude');
  mkdirSync(dirname(path),{recursive:true});
  const current=existsSync(path)?readFileSync(path,'utf8'):'';
  if(!current.split(/\r?\n/).includes('.ghost.*'))
    appendFileSync(path,(current && !current.endsWith('\n')?'\n':'')+'.ghost.*\n');
}

function git(run, ...args) {
  try {
    return execFileSync('git', ['-c', 'user.name=Neo Project Runner', '-c', 'user.email=neo-run@localhost',
      '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', '-C', run, ...args], { encoding: 'utf8', timeout: 30000,
      stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    fail(`git ${args[0]} failed: ${String(error.stderr || error.message).trim().slice(0, 350)}`);
  }
}

export function loadRunGitConfig(project, declaration) {
  const spec = declaration.versioning;
  if (!spec) return null;
  if (spec.mode !== 'local-git' || spec.template !== 'run-template')
    fail('versioning requires local-git and run-template');
  const template = join(project, 'run-template', '.gitignore');
  if (!existsSync(template) || lstatSync(template).isSymbolicLink() ||
      !lstatSync(template).isFile() || !inside(realpathSync(project), realpathSync(template)))
    fail('project run-template/.gitignore is missing or unsafe');
  const rules = readFileSync(template, 'utf8');
  if (!rules.trim()) fail('empty run-template/.gitignore');
  return { rules };
}

export function ensureRunGit(run, config) {
  if (!config) return;
  chmodSync(run, 0o700);
  const marker = join(run, '.git');
  if (existsSync(marker)) {
    if (lstatSync(marker).isSymbolicLink() || !lstatSync(marker).isDirectory() ||
        realpathSync(git(run, 'rev-parse', '--show-toplevel')) !== realpathSync(run))
      fail('existing Run Git must be an independent local repository');
    if (git(run, 'remote').trim()) fail('Run Git must have no remotes');
    ensureRunGlobalExcludes(run);
    const existingIgnore = join(run, '.gitignore');
    if (!existsSync(existingIgnore) || lstatSync(existingIgnore).isSymbolicLink() ||
        !lstatSync(existingIgnore).isFile()) fail('Run .gitignore is missing or unsafe');
    // Copy templates only on creation; never overwrite existing Run history.
    const head = spawnSync('git', ['-C', run, 'rev-parse', '--verify', 'HEAD'],
      {stdio:'ignore',timeout:10000});
    if (head.status !== 0) {
      const indexed = git(run, 'ls-files').trim();
      if (indexed && indexed !== '.gitignore') fail('unfinished Run Git initialization has unexpected staged files');
      git(run, 'add', '--', '.gitignore');
      git(run, 'commit', '-q', '-m', 'run: initialize local version history');
    }
    return;
  }
  const ignore = join(run, '.gitignore');
  if (existsSync(ignore)) {
    if (lstatSync(ignore).isSymbolicLink() || readFileSync(ignore, 'utf8') !== config.rules)
      fail('existing Run .gitignore differs from project run-template; preserve file');
  } else {
    writeFileSync(ignore, config.rules, { mode: 0o600, flag: 'wx' });
  }
  git(run, 'init', '-q', '-b', 'run');
  ensureRunGlobalExcludes(run);
  chmodSync(marker, 0o700);
  git(run, 'add', '--', '.gitignore');
  git(run, 'commit', '-q', '-m', 'run: initialize local version history');
}

/** Verified Stage commits use the Run's own .gitignore.
 * Never stage files in the Project checkout or a remote-enabled repository.
 * Refuse symlinks and gitlinks rather than silently snapshotting external paths.
 */
function stageRunChanges(run) {
  ensureRunGlobalExcludes(run);
  const stagedBefore = git(run, 'diff', '--cached', '--name-only');
  if (stagedBefore) fail('unexpected staged files in Run Git; refusing to include concurrent changes');
  const candidates = execFileSync('git', ['-C', run, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    {encoding:'utf8',timeout:30000,maxBuffer:16*1024*1024}).split('\0').filter(Boolean);
  for (const path of candidates) {
    const full = join(run, path);
    if (!inside(run, full)) fail('artifact escaped Run Git');
    const entry = lstatSync(full, {throwIfNoEntry:false});
    if (entry && (!entry.isFile() || entry.isSymbolicLink() || !inside(realpathSync(run), realpathSync(full))))
      fail('unsafe Run artifact (symlink or non-file): ' + path);
  }
  git(run, 'add', '-A');
  const staged = git(run, 'diff', '--cached', '--name-only').split('\n').filter(Boolean);
  // Guard against Git links in the index, including nested repositories.
  const index = execFileSync('git', ['-C', run, 'ls-files', '--stage', '-z'],
    {encoding:'utf8',timeout:30000,maxBuffer:16*1024*1024});
  if (index.split('\0').some(row => row && /^(120000|160000) /.test(row)))
    fail('Run Git must not track symlinks or submodules');
  return staged;
}

export function commitRunStage(run, config, nodeId, executionId = null) {
  if (!config) return null;
  ensureRunGit(run, config);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(nodeId)) fail('invalid Stage nodeId');
  if (executionId !== null && (typeof executionId !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(executionId)))
    fail('invalid Stage executionId');
  const staged = stageRunChanges(run);
  // Replayed stages keep their original SHA and must not consume newer edits.
  if (executionId) {
    const history = git(run, 'log', '--format=%H%x00%B%x00', '-n', '1000').split('\0');
    for (let index = 0; index + 1 < history.length; index += 2) {
      const [sha, body] = [history[index].trim(), history[index + 1]];
      if (body.includes(`Run-Stage: ${nodeId}\nRun-Execution: ${executionId}\n`)) {
        if (staged.length) fail('replayed Stage has uncommitted changes; refusing a mismatched checkpoint');
        return { commitSha: sha, changed: false, reused: true, files: [] };
      }
    }
  }
  if (staged.length || nodeId !== 'recovery') {
    git(run, 'commit', '-q', '--allow-empty', '-m', `run: ${nodeId} verified`, '-m',
      `Run-Stage: ${nodeId}\nRun-Execution: ${executionId ?? 'none'}`);
  }
  return { commitSha: git(run, 'rev-parse', 'HEAD'), changed: staged.length > 0, reused: false, files: staged };
}
