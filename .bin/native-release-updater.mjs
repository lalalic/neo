// Local opt-in native release automation. Relay owns Jobs; its release scripts
// own publication, package validation, idle/process fencing and rollback.
import { readFile, writeFile, rename, mkdir, realpath } from 'node:fs/promises';
import { dirname, join, basename, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const sha = x => typeof x === 'string' && /^[0-9a-f]{40}$/.test(x);
const id = x => typeof x === 'string' && /^[1-9][0-9]*$/.test(x);
const cursor = x => Number.isSafeInteger(x) && x >= 0;
const packageName = 'agents-relay';
const file = join(homedir(), '.config/neo/native-auto-release.json');
const stateFile = join(homedir(), '.local/state/neo/native-auto-release.json');
const get = async path => JSON.parse(await readFile(path, 'utf8'));
async function save(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = path + '.' + process.pid + '.tmp';
  await writeFile(tmp, JSON.stringify(value) + '\n', { mode: 0o600 });
  await rename(tmp, path);
}
export function validateConfig(c) {
  if (!c || !isAbsolute(c.repositoryRoot ?? '') || basename(c.repositoryRoot) !== packageName ||
      !isAbsolute(c.packageRoot ?? '') || !cursor(c.startAfter) ||
      typeof c.autoPublish !== 'boolean' || typeof c.autoLive !== 'boolean' ||
      c.livePolicy !== 'when-idle' ||
      (c.seedJobId !== undefined && !id(c.seedJobId)) ||
      (c.seedSha !== undefined && (!c.seedJobId || !sha(c.seedSha)))) throw Error('Invalid native release configuration');
  return c;
}
export function mergeCandidate(event) {
  const jobId = event?.job_id;
  const commit = event?.data?.mergedCommitSha;
  return event?.type === 'job.merge.succeeded' && id(jobId) && sha(commit) &&
    typeof event.source?.id === 'string' && event.source.id.startsWith('job/' + jobId + '/task/merge/execution/')
    ? { jobId, sha: commit } : null;
}
export function nativeCandidate(event) {
  const d = event?.data;
  return event?.type === 'package.published' && d?.registry === 'native' &&
    d.package === packageName && sha(d.sha) && typeof d.version === 'string' && /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(d.version) &&
    event.source?.id === 'release/' + packageName + '/' + d.sha &&
    event.event_id === 'release:' + packageName + ':' + d.sha + ':package.published'
    ? d.sha : null;
}
export function initialState(c) {
  return { version: 1, repositoryRoot: c.repositoryRoot, packageRoot: c.packageRoot, startAfter: c.startAfter,
    mergeCursor: c.startAfter, releaseCursor: c.startAfter, jobs: {}, releases: [], seeded: false, publishIntent: null };
}
function validateState(s, c) {
  if (s.version !== 1 || s.repositoryRoot !== c.repositoryRoot || s.packageRoot !== c.packageRoot ||
      s.startAfter !== c.startAfter || !cursor(s.mergeCursor) || !cursor(s.releaseCursor) ||
      !s.jobs || !Array.isArray(s.releases) || s.releases.some(x => !sha(x)) ||
      Object.entries(s.jobs).some(([k,v]) => !id(k) || (v !== null && !sha(v)))) {
    throw Error('Native release state/config mismatch; inspect before resetting cursor');
  }
}
export async function reconcile(c, s, io) {
  validateState(s, c);
  // Durable history is the wake source; no dependence on a live-only NATS
  // subscription. Persist cursor and candidate together before running commands.
  if (!s.seeded) {
    if (c.seedJobId) s.jobs[c.seedJobId] = null;
    s.seeded = true;
    await io.save(s);
  }
  for (const [type, key, accept] of [
    ['job.merge.succeeded', 'mergeCursor', e => { const m = mergeCandidate(e); if (m) s.jobs[m.jobId] = m.sha; }],
    ['package.published', 'releaseCursor', e => { const x = nativeCandidate(e); if (x && !s.releases.includes(x)) s.releases.push(x); }],
  ]) {
    const page = await io.history(type, s[key]);
    if (page.order !== 'asc' || !Array.isArray(page.events) || page.events.length > 100 ||
        page.events.some((r,i) => !cursor(r.cursor) || r.cursor <= (i ? page.events[i-1].cursor : s[key]) || r.event?.type !== type))
      throw Error('Invalid release history page');
    for (const row of page.events) accept(row.event);
    if (page.events.length) s[key] = page.events.at(-1).cursor;
    await io.save(s);
  }
  const head = await io.main();
  const current = await io.live();
  if (!sha(head) || !sha(current) || !await io.ancestor(current,head)) throw Error('Invalid main/live identity');
  // Select only a verified receipt on current main, never an older or divergent
  // release. Keep pending failed/missing receipts for retry.
  let newest = current;
  for (const candidate of s.releases) {
    if (!await io.ancestor(candidate, head)) continue;
    if (await io.receipt(candidate) && await io.ancestor(newest, candidate)) newest = candidate;
  }
  let eligible = [];
  for (const [jobId, expected] of Object.entries(s.jobs)) {
    let job;
    try { job = await io.job(jobId); } catch(e) { io.warn?.('Job lookup pending '+jobId+': '+e.message); continue; }
    if (job.id !== jobId) throw Error('Relay Job identity mismatch');
    if (job.repository !== packageName || job.projectRoot !== c.repositoryRoot ||
        ['CANCELLED','FAILED'].includes(job.state)) { delete s.jobs[jobId]; continue; }
    if (job.state !== 'COMPLETED') continue;
    const m = job.localMerge;
    if (m?.status !== 'succeeded' || m.targetRef !== 'refs/heads/main' ||
        !sha(m.mergedCommitSha) || (expected && expected !== m.mergedCommitSha)) {
      delete s.jobs[jobId]; continue;
    }
    if (await io.ancestor(m.mergedCommitSha, newest)) { delete s.jobs[jobId]; continue; }
    if (m.mergedCommitSha === head || (jobId === c.seedJobId && c.seedSha === head && await io.ancestor(m.mergedCommitSha,head))) eligible.push(jobId);
  }
  await io.save(s);
  if (c.autoPublish && eligible.length && newest !== head) {
    const jobId = s.publishIntent?.sha === head && eligible.includes(s.publishIntent.jobId)
      ? s.publishIntent.jobId : eligible.at(-1);
    if (await io.receipt(head)) newest = head;
    else {
      // Recheck main immediately before invoking the canonical publisher; the
      // publisher independently verifies clean main, Job ancestry and package.
      if (await io.main() !== head) return;
      s.publishIntent = { jobId, sha: head };
      await io.save(s);
      await io.publish(jobId, head);
      if (!await io.receipt(head)) throw Error('Publication receipt missing for selected SHA');
      newest = head;
    }
    s.publishIntent = null;
    if (!s.releases.includes(newest)) s.releases.push(newest);
    await io.save(s);
  }
  if (c.autoLive && newest !== current) {
    await io.activate(newest,current);
    if (await io.live() !== newest) throw Error('Live SHA verification failed');
  }
  // Prune only known covered releases. A failed activation exits above and
  // preserves all pending state; an older event cannot downgrade live.
  const actual = await io.live();
  const remaining = [];
  for (const candidate of s.releases) {
    if (!await io.ancestor(candidate, actual)) remaining.push(candidate);
  }
  s.releases = remaining;
  s.lastLiveSha = actual;
  await io.save(s);
}
export async function startNativeReleaseUpdater({ apiUrl, log = console, configPath = file, storePath = stateFile } = {}) {
  const endpoint = new URL(apiUrl);
  const localEndpoint = endpoint.protocol === 'http:' && ['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname)
    && !endpoint.username && !endpoint.password && endpoint.pathname === '/' && !endpoint.search && !endpoint.hash;
  apiUrl = endpoint.origin;
  let running = false, failures = 0, retryAt = 0;
  const tick = async () => {
    if (running || Date.now() < retryAt) return;
    running = true;
    try {
      let c;
      try { c = validateConfig(await get(configPath)); }
      catch (e) { if (e.code === 'ENOENT') return; throw e; }
      if (!c.autoPublish && !c.autoLive) return;
      if (!localEndpoint) throw Error('Expected local Events Bus HTTP endpoint');
      if (await realpath(c.repositoryRoot) !== c.repositoryRoot || await realpath(c.packageRoot) !== c.packageRoot)
        throw Error('Native release roots must be canonical');
      let s;
      try { s = await get(storePath); }
      catch(e) { if (e.code !== 'ENOENT') throw e; s = initialState(c); }
      const command = async (cmd,args,timeout=30000) => (await exec(cmd,args,{cwd:c.repositoryRoot,timeout,maxBuffer:64*1024*1024})).stdout.trim();
      const git = (...args) => command('git',args);
      if (await git('rev-parse','--show-toplevel') !== c.repositoryRoot) throw Error('Configured root is not Git root');
      const json = async url => {
        const response = await fetch(url, {signal:AbortSignal.timeout(10000),redirect:'error'});
        if (!response.ok) throw Error('HTTP '+response.status);
        return response.json();
      };
      const io = {
        save: v => save(storePath,v),
        warn: message => log.error(message),
        history: (type,after) => json(apiUrl+'/events?'+new URLSearchParams({type,after:String(after),order:'asc',limit:'100'})),
        job: async jobId => JSON.parse(await command('agents-relay',['job','show','--id',jobId])),
        main: async () => {
          if (await git('branch','--show-current') !== 'main' || await git('status','--porcelain'))
            throw Error('Native release pending: main checkout is dirty or not main');
          return git('rev-parse','HEAD');
        },
        ancestor: async (a,b) => {
          if (!sha(a)||!sha(b)) return false;
          try { await git('merge-base','--is-ancestor',a,b); return true; }
          catch(e) { if (e.code === 1 || e.code === 128) return false; throw e; }
        },
        receipt: async x => {
          try {
            const r=await get(join(c.packageRoot,'receipts',x+'.json'));
            return nativeCandidate(r.event)===x &&
              (await readFile(join(c.packageRoot,'versions',x,'SOURCE_REVISION'),'utf8')).trim()===x;
          } catch(e) { if (e.code==='ENOENT') return false; throw e; }
        },
        live: async () => (await json('http://127.0.0.1:8787/api/version')).sourceRef,
        publish: async (jobId,expected) => {
          if (await io.main()!==expected) throw Error('Release main moved');
          await command(process.execPath,['scripts/publish-native.mjs','--job-id',jobId,'--sha',expected,'--root',c.packageRoot,'--events-api',apiUrl],900000);
          log.log('Native release published',jobId,expected);
        },
        activate: async (x,current) => {
          await command(process.execPath,['scripts/live-native.mjs','--sha',x,'--expected-live-sha',current,'--root',c.packageRoot],120000);
          log.log('Native release activated',x);
        },
      };
      await reconcile(c,s,io);
      failures=0; retryAt=0;
    } catch(e) {
      retryAt=Date.now()+Math.min(120000,15000*2**Math.min(failures++,3));
      log.error('Native release pending:',e.message);
    }
    finally { running=false; }
  };
  // Independent asynchronous polling keeps npm event handling responsive.
  void tick();
  return setInterval(()=>void tick(),15000);
}
