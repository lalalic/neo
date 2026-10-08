#!/usr/bin/env node
import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, openSync, readSync, closeSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, constants as osConstants } from 'node:os';

const root = process.env.NEO_QUEUE_HOME || join(homedir(), '.neo', 'execution-queue');
mkdirSync(root, { recursive: true, mode: 0o700 });
const db = new DatabaseSync(join(root, 'queue.sqlite'));
db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, queue TEXT NOT NULL, status TEXT NOT NULL, command TEXT NOT NULL, cwd TEXT NOT NULL, created INTEGER NOT NULL, started INTEGER, ended INTEGER, pid INTEGER, code INTEGER, signal TEXT, error TEXT, timeout INTEGER NOT NULL DEFAULT 300000, dedupe TEXT); CREATE INDEX IF NOT EXISTS jobs_next ON jobs(status,queue,created); CREATE UNIQUE INDEX IF NOT EXISTS jobs_dedupe ON jobs(queue,dedupe) WHERE dedupe IS NOT NULL AND status IN (\'queued\',\'running\');');
const columns=db.prepare('PRAGMA table_info(jobs)').all().map(row=>row.name);
if(!columns.includes('retries')) db.exec('ALTER TABLE jobs ADD COLUMN retries INTEGER NOT NULL DEFAULT 0');
if(!columns.includes('attempts')) db.exec('ALTER TABLE jobs ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0');
db.exec('CREATE TABLE IF NOT EXISTS waiters (job TEXT NOT NULL, token TEXT PRIMARY KEY, pid INTEGER NOT NULL)');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const logPath = (id, stream) => join(root, id + '.' + stream);
const get = id => db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
const args = process.argv.slice(2);
function flag(name, fallback) { const i=args.indexOf(name); return i<0 ? fallback : args[i+1]; }
function enqueue() {
  const cut=args.indexOf('--');
  if(cut<0 || !args[cut+1]) throw Error('Usage: neo-queue run|submit --queue NAME [--timeout MS] [--dedupe KEY] -- COMMAND [ARGS...]');
  const queue=flag('--queue', 'media-ai'), timeout=Number(flag('--timeout','300000')), retries=Number(flag('--retries','0'));
  if(!/^[a-z0-9][\w-]*$/.test(queue) || !Number.isSafeInteger(timeout) || timeout<1 || !Number.isSafeInteger(retries) || retries<0 || retries>10) throw Error('Invalid queue or timeout');
  const id=randomUUID(), command=JSON.stringify(args.slice(cut+1));
  const dedupe=flag('--dedupe',null);
  const insert=db.prepare('INSERT INTO jobs (id,queue,status,command,cwd,created,timeout,dedupe,retries) VALUES (?,?,?,?,?,?,?,?,?)');
  try { insert.run(id,queue,'queued',command,process.cwd(),Date.now(),timeout,dedupe,retries); return id; }
  catch(e) { if(!dedupe) throw e; const old=db.prepare("SELECT id FROM jobs WHERE queue=? AND dedupe=? AND status IN ('queued','running')").get(queue,dedupe); if(!old) throw e; if(get(old.id).command!==command) throw Error('Deduplication key already bound to a different command'); return old.id; }
}
function cancel(id) {
  const job=get(id); if(!job) throw Error('Unknown job');
  if(job.status==='queued') db.prepare("UPDATE jobs SET status='cancelled',ended=? WHERE id=? AND status='queued'").run(Date.now(),id);
  else if(job.status==='running') db.prepare("UPDATE jobs SET status='cancelling' WHERE id=? AND status='running'").run(id);
}
async function follow(id) {
  let offsets={stdout:0,stderr:0}; let interrupted=false;
  const token=randomUUID();
  db.prepare('INSERT INTO waiters (job,token,pid) VALUES (?,?,?)').run(id,token,process.pid);
  const detach=()=>{db.prepare('DELETE FROM waiters WHERE token=?').run(token);};
  const stop=()=>{
    interrupted=true;detach();
    for(const w of db.prepare('SELECT token,pid FROM waiters WHERE job=?').all(id)) if(!alive(w.pid)) db.prepare('DELETE FROM waiters WHERE token=?').run(w.token);
    if(db.prepare('SELECT count(*) AS n FROM waiters WHERE job=?').get(id).n===0) cancel(id);
  };
  process.once('SIGINT',stop); process.once('SIGTERM',stop);
  for(;;) {
    for(const stream of ['stdout','stderr']) {
      const file=logPath(id,stream);
      if(!existsSync(file)) continue;
      const fd=openSync(file,'r'); const chunks=[]; const buffer=Buffer.alloc(65536);
      try { let n; while((n=readSync(fd,buffer,0,buffer.length,offsets[stream]))>0) { offsets[stream]+=n; chunks.push(Buffer.from(buffer.subarray(0,n))); } }
      finally { closeSync(fd); }
      for(const chunk of chunks) (stream==='stdout'?process.stdout:process.stderr).write(chunk);
    }
    const job=get(id);
    if(['completed','failed','cancelled'].includes(job.status)) {
      detach();process.exitCode=job.code??(job.status==='cancelled'?130:1); return;
    }
    if(interrupted) { process.exitCode=130; return; }
    await sleep(100);
  }
}
function alive(pid){try {process.kill(pid,0);return true;}catch{return false;}}
function groupAlive(pid){try {process.kill(-pid,0);return true;}catch{return false;}}
async function reap(pid) {
  if(!pid || !Number.isInteger(pid) || pid<=1) return;
  try {process.kill(-pid,'SIGTERM');}catch{}
  for(let i=0;i<20;i++){if(!groupAlive(pid)) return;await sleep(100);}
  try{process.kill(-pid,'SIGKILL');}catch{}
  for(let i=0;i<20;i++){if(!groupAlive(pid)) return;await sleep(100);}
  throw Error('Unreaped child process group '+pid);
}
async function executeJob(job) {
  const [program,...argv]=JSON.parse(job.command);
  const out=openSync(logPath(job.id,'stdout'),'w',0o600), err=openSync(logPath(job.id,'stderr'),'w',0o600);
  let child,code=1,signal=null,reason=null;
  try {
    child=spawn(program,argv,{cwd:job.cwd,stdio:['ignore',out,err],detached:true,env:process.env,shell:false});
    await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
    db.prepare('UPDATE jobs SET pid=? WHERE id=?').run(child.pid,job.id);
    const result=await new Promise(resolve=>{
      child.once('close',(c,s)=>resolve({code:c,signal:s}));
      const timer=setInterval(()=>{
        const latest=get(job.id);
        if(latest.status==='cancelling'||Date.now()-latest.started>=job.timeout) {
          clearInterval(timer);
          reason=latest.status==='cancelling'?'cancelled':'timeout';
          try{process.kill(-child.pid,'SIGTERM');}catch{}
        }
      },100);
      child.once('close',()=>clearInterval(timer));
    });
    code=reason==='cancelled'?130:reason==='timeout'?124:(result.code??(result.signal?128+(osConstants.signals[result.signal]??0):1));
    signal=result.signal;
    // Do not release a queue slot while descendants from the prior command survive.
    try { await reap(child.pid); } catch(error) { reason=error.message;code=1; }
  } catch(error){reason=error.message;}
  finally {closeSync(out);closeSync(err);}
  if(code!==0 && !reason && job.attempts<job.retries) {
    db.prepare("UPDATE jobs SET status='queued',pid=NULL,started=NULL WHERE id=?").run(job.id);
  } else {
    db.prepare('UPDATE jobs SET status=?,ended=?,code=?,signal=?,error=? WHERE id=?').run(reason==='cancelled'?'cancelled':code===0?'completed':'failed',Date.now(),code,signal,reason,job.id);
  }
}
async function worker() {
  const lock=join(root,'worker.lock');
  try { mkdirSync(lock); }
  catch {
    const prior=Number(existsSync(join(lock,'pid'))?readFileSync(join(lock,'pid'),'utf8'):0);
    if(prior && alive(prior)) throw Error('Queue worker already running');
    rmSync(lock,{recursive:true,force:true});mkdirSync(lock);
  }
  writeFileSync(join(lock,'pid'),String(process.pid));
  process.once('exit',()=>{try{rmSync(lock,{recursive:true});}catch{}});

  const capacities=JSON.parse(process.env.NEO_QUEUE_CAPACITIES||'{}');
  for(const [name,limit] of Object.entries(capacities)) {
    if(!/^[a-z0-9][\w-]*$/.test(name) || !Number.isInteger(limit) || limit<1 || limit>8 || (name==='media-ai' && limit!==1)) throw Error('Invalid per-queue capacity: '+name);
  }
  const stale=db.prepare("SELECT * FROM jobs WHERE status IN ('running','cancelling')").all();
  for(const job of stale) {
    await reap(job.pid);
    db.prepare("UPDATE jobs SET status='failed',ended=?,code=137,error='worker interrupted; prior process group reaped' WHERE id=?").run(Date.now(),job.id);
  }
  // Retain audit metadata but remove old terminal-job stream files.
  const retentionDays=Number(process.env.NEO_QUEUE_LOG_RETENTION_DAYS??7);
  if(!Number.isInteger(retentionDays)||retentionDays<1||retentionDays>365) throw Error('Invalid log retention days');
  const pruneLogs=()=>{
    const expired=db.prepare("SELECT id FROM jobs WHERE status IN ('completed','failed','cancelled') AND ended<?").all(Date.now()-retentionDays*86400000);
    for(const row of expired) for(const stream of ['stdout','stderr']) {
      try{unlinkSync(logPath(row.id,stream));}catch(error){if(error.code!=='ENOENT') console.error('Log cleanup:',error.message);}
    }
  };
  let lastPrune=0;
  const active=new Map();
  let stopping=false;
  const shutdown=async()=>{
    if(stopping) return;
    stopping=true;
    const running=db.prepare("SELECT id,pid FROM jobs WHERE status IN ('running','cancelling')").all();
    for(const job of running) {
      try { await reap(job.pid); }
      catch(error) {console.error('Unable to terminate child process group:',error.message);process.exitCode=1;}
      db.prepare("UPDATE jobs SET status='failed',ended=?,code=143,error='worker stopped' WHERE id=? AND status IN ('running','cancelling')").run(Date.now(),job.id);
    }
    process.exit(process.exitCode??0);
  };
  process.once('SIGTERM',()=>{void shutdown();});
  process.once('SIGINT',()=>{void shutdown();});
  for(;!stopping;) {
    if(Date.now()-lastPrune>60000){pruneLogs();lastPrune=Date.now();}
    const queued=db.prepare("SELECT * FROM jobs WHERE status='queued' ORDER BY created,id").all();
    for(const candidate of queued) {
      const limit=candidate.queue==='media-ai'?1:(capacities[candidate.queue]??1);
      if((active.get(candidate.queue)??0)>=limit) continue;
      // Only one PM2-owned worker dispatches. This atomic UPDATE protects the claim.
      const now=Date.now();
      const claim=db.prepare("UPDATE jobs SET status='running',started=?,attempts=attempts+1 WHERE id=? AND status='queued'").run(now,candidate.id);
      if(!claim.changes) continue;
      const job={...candidate,started:now};
      active.set(job.queue,(active.get(job.queue)??0)+1);
      void executeJob(job).catch(error=>{
        db.prepare("UPDATE jobs SET status='failed',ended=?,code=1,error=? WHERE id=?").run(Date.now(),String(error),job.id);
      }).finally(()=>active.set(job.queue,(active.get(job.queue)??1)-1));
    }
    await sleep(100);
  }
}

try {
  if(args[0]==='worker') await worker();
  else if(args[0]==='run' || args[0]==='submit') {
    if(args[0]==='run') {
      const lock=join(root,'worker.lock','pid');
      const pid=existsSync(lock)?Number(readFileSync(lock,'utf8')):0;
      if(!pid || !alive(pid)) throw Error('Queue worker unavailable: start neo-queue-worker with PM2');
    }
    const id=enqueue();if(args[0]==='submit') console.log(id);else await follow(id);}
  else if(args[0]==='status') console.log(JSON.stringify(db.prepare('SELECT queue,status,count(*) AS count FROM jobs GROUP BY queue,status').all(),null,2));
  else if(args[0]==='list') console.log(JSON.stringify(db.prepare('SELECT id,queue,status,created,started,ended,code,error FROM jobs ORDER BY created DESC LIMIT 30').all(),null,2));
  else if(args[0]==='cancel') { if(!args[1]) throw Error('cancel ID');cancel(args[1]);}
  else throw Error('Commands: worker | run | submit | status | list | cancel ID');
} catch(e) { console.error(e.message);process.exitCode=1; }
