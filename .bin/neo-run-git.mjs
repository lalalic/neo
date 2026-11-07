import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';

const fail = message => { throw new Error(`Run Git: ${message}`); };
const inside = (root, path) => {
  const rel = relative(root, path);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
};
const revisionTag = /^review\/r([1-9][0-9]*)$/;

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
  if (spec.mode !== 'local-git' || spec.template !== 'run-template' ||
      !Array.isArray(spec.trackedArtifacts) || !spec.trackedArtifacts.length)
    fail('versioning requires local-git, run-template and nonempty trackedArtifacts');
  const template = join(project, 'run-template', '.gitignore');
  if (!existsSync(template) || lstatSync(template).isSymbolicLink() ||
      !lstatSync(template).isFile() || !inside(realpathSync(project), realpathSync(template)))
    fail('project run-template/.gitignore is missing or unsafe');
  const rules = readFileSync(template, 'utf8');
  if (!rules.trim()) fail('empty run-template/.gitignore');
  const paths = new Set(), creativePatterns = new Set();
  for (const path of spec.trackedArtifacts) {
    // Deliberately narrow, nonrecursive project allowlist pattern: one safe
    // creative ID folder and one approved text/QA file, never arbitrary globs.
    const creative = typeof path==='string' ? /^creatives\/\*\/(video\.md|qa\.json)$/.exec(path) : null;
    if (creative) {
      if (creativePatterns.has(creative[1])) fail(`invalid/duplicate tracked artifact: ${path}`);
      creativePatterns.add(creative[1]);
      continue;
    }
    if (typeof path !== 'string' || !/^[A-Za-z0-9_][A-Za-z0-9_.\/-]*$/.test(path) ||
        path.split('/').some(part => !part || part === '.' || part === '..') ||
        path.startsWith('.git') || path === '.gitignore' || paths.has(path) ||
        /(^|\/)(source-reference\.json|source-manifest\.json|publisher-request\.json|\.env(?:\..+)?|user\.md|neo-project-run\..+|[^/]+\.(?:pem|key|p12))$/.test(path))
      fail(`invalid/duplicate tracked artifact: ${path}`);
    paths.add(path);
  }
  return { rules, paths, creativePatterns };
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
  chmodSync(marker, 0o700);
  git(run, 'add', '--', '.gitignore');
  git(run, 'commit', '-q', '-m', 'run: initialize local version history');
}

function approvedFiles(run, config) {
  const chosen = new Set();
  for (const file of config.paths) {
    const full = join(run, file);
    if (!inside(run, full)) fail(`artifact path escape: ${file}`);
    const entry = lstatSync(full, {throwIfNoEntry:false});
    if (!entry) {
      if (git(run, 'ls-files', '--', file)) chosen.add(file);
      continue;
    }
    if (entry.isSymbolicLink() || !entry.isFile() || !inside(realpathSync(run), realpathSync(full)))
      fail(`artifact is not a regular file inside the Run: ${file}`);
    chosen.add(file);
  }
  if(config.creativePatterns?.size) {
    const base=join(run,'creatives');
    const candidateIds=new Set();
    if(existsSync(base)) {
      if(lstatSync(base).isSymbolicLink() || !lstatSync(base).isDirectory() ||
          !inside(realpathSync(run),realpathSync(base)))
        fail('creative artifacts directory must be a private regular directory');
      for(const entry of readdirSync(base,{withFileTypes:true})) {
        if(!/^[a-z0-9][a-z0-9-]*$/.test(entry.name)) continue;
        if(entry.isSymbolicLink()) fail('symlinked creative directory is not permitted');
        if(entry.isDirectory()) candidateIds.add(entry.name);
      }
    }
    // Track deleted and renamed allowlisted files too, rather than silently
    // keeping old creative revisions in the next checkpoint.
    for(const path of git(run,'ls-files','--','creatives').split('\n').filter(Boolean)) {
      const parts=path.split('/');
      if(parts.length===3 && /^[a-z0-9][a-z0-9-]*$/.test(parts[1]) &&
          config.creativePatterns.has(parts[2])) candidateIds.add(parts[1]);
    }
    for(const id of candidateIds) for(const filename of config.creativePatterns) {
      const rel=`creatives/${id}/${filename}`, full=join(run,rel);
      if(!inside(run,full))fail('creative artifact path escaped run');
      const entry=lstatSync(full,{throwIfNoEntry:false});
      if(entry && (entry.isSymbolicLink() || !entry.isFile() ||
          !inside(realpathSync(run),realpathSync(full))))
        fail(`creative artifact not a regular file within Run: ${rel}`);
      if(entry || git(run,'ls-files','--',rel))chosen.add(rel);
    }
  }
  return [...chosen];
}

export function commitRunStage(run, config, nodeId, executionId = null) {
  if (!config) return null;
  ensureRunGit(run, config);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(nodeId)) fail('invalid Stage nodeId');
  if (executionId !== null && (typeof executionId !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(executionId)))
    fail('invalid Stage executionId');
  const selected = approvedFiles(run, config);
  const stagedBefore = git(run, 'diff', '--cached', '--name-only');
  if (stagedBefore) fail('unexpected staged files in Run Git; refusing to include concurrent changes');
  // Git only stages allowlisted paths, never "git add -A".
  for (const path of selected) {
    const check = spawnSync('git', ['-C', run, 'check-ignore', '-q', '--', path],
      { stdio: 'ignore', timeout: 10000 });
    if (check.error || ![0, 1].includes(check.status)) fail('cannot inspect Run Git ignore rules');
    if (check.status === 0) fail(`allowlisted artifact is ignored by Run template: ${path}`);
    git(run, 'add', '-A', '--', path);
  }
  const staged = git(run, 'diff', '--cached', '--name-only').split('\n').filter(Boolean);
  const accepted=new Set(selected);
  if (staged.some(file => !accepted.has(file)))
    fail('staged path escaped project allowlist');
  // The same Relay node event may be replayed after an interruption. Its
  // execution ID is the durable idempotency fence, not the current HEAD.
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
  // An empty commit is still a meaningful verified Stage version. A recovery
  // invocation without a Relay node event only commits real pending changes.
  if (staged.length || nodeId !== 'recovery') {
    git(run, 'commit', '-q', '--allow-empty', '-m', `run: ${nodeId} verified`, '-m',
      `Run-Stage: ${nodeId}\nRun-Execution: ${executionId ?? 'none'}`);
  }
  return { commitSha: git(run, 'rev-parse', 'HEAD'), changed: staged.length > 0, reused: false, files: staged };
}

export function assertReviewCheckpoint(run, config, commitSha) {
  if (!config) fail('project does not support Git SHA reviews');
  ensureRunGit(run, config);
  if (!/^[a-f0-9]{40}$/.test(commitSha) || git(run, 'rev-parse', 'HEAD') !== commitSha)
    fail('review must target current full Git Commit SHA');
  const selected = approvedFiles(run, config);
  for (const file of selected) {
    const changed = spawnSync('git', ['-C', run, 'status', '--porcelain', '--untracked-files=all', '--', file],
      { encoding: 'utf8', timeout: 10000 });
    if (changed.error || changed.status !== 0 || changed.stdout.trim())
      fail('review has uncommitted allowlisted changes: ' + file);
  }
  return commitSha;
}

export function tagRunReview(run, config, preview, commitSha = null) {
  if (!config || !preview || preview.status !== 'review_requested') return null;
  if (!/^[a-f0-9]{40}$/.test(preview.commitSha || '') ||
      typeof preview.requestId !== 'string' || !/^[A-Za-z0-9_.:-]+$/.test(preview.requestId))
    fail('review request requires commitSha and requestId');
  const sha = assertReviewCheckpoint(run, config, commitSha ?? preview.commitSha);
  if (sha !== preview.commitSha) fail('Review preview Commit SHA mismatch');
  const names = git(run, 'tag', '--list', 'review/r*').split('\n').filter(Boolean);
  for (const tag of names) {
    if (git(run, 'rev-list', '-n', '1', tag) !== sha) continue;
    return { tag, commitSha: sha, reused: true };
  }
  const number = 1 + Math.max(0, ...names.map(name => revisionTag.exec(name)?.[1]).filter(Boolean).map(Number));
  const tag = `review/r${number}`;
  git(run, 'tag', '-a', tag, sha, '-m', JSON.stringify({commitSha:sha,requestId:preview.requestId}));
  return { tag, commitSha: sha, reused: false };
}
