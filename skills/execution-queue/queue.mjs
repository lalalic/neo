#!/usr/bin/env node
import { DatabaseSync } from 'node:sqlite';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, openSync, readSync, closeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const root = process.env.NEO_QUEUE_HOME || join(homedir(), '.neo', 'execution-queue');
mkdirSync(root, { recursive: true, mode: 0o700 });
const db = new DatabaseSync(join(root, 'queue.sqlite'));
db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, queue TEXT NOT NULL, status TEXT NOT NULL, command TEXT NOT NULL, cwd TEXT NOT NULL, created INTEGER NOT NULL, started INTEGER, ended INTEGER, pid INTEGER, code INTEGER, signal TEXT, error TEXT, timeout INTEGER NOT NULL DEFAULT 300000, dedupe TEXT); CREATE INDEX IF NOT EXISTS jobs_next ON jobs(status,queue,created); CREATE UNIQUE INDEX IF NOT EXISTS jobs_dedupe ON jobs(queue,dedupe) WHERE dedupe IS NOT NULL AND status IN (\'queued\',\'running\');');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const logPath = (id, stream) => join(root, id + '.' + stream);
const get = id => db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
const args = process.argv.slice(2);
function flag(name, fallback) { const i=args.indexOf(name); return i<0 ? fallback : args[i+1]; }
function enqueue() {
  const cut=args.indexOf('--');
  if(cut<0 || !args[cut+1]) throw Error('Usage: neo-queue run|submit --queue NAME [--timeout MS] [--dedupe KEY] -- COMMAND [ARGS...]');
  const queue=flag('--queue', 'media-ai'), timeout=Number(flag('--timeout','300000'));
  if(!/^[a-z0-9][\w-]*$/.test(queue) || !Number.isSafeInteger(timeout) || timeout<1) throw Error('Invalid queue or timeout');
  const id=randomUUID(), command=JSON.stringify(args.slice(cut+1));
  const dedupe=flag('--dedupe',null);
  const insert=db.prepare('INSERT INTO jobs (id,queue,status,command,cwd,created,timeout,dedupe) VALUES (?,?,?,?,?,?,?,?)');
  try { insert.run(id,queue,'queued',command,process.cwd(),Date.now(),timeout,dedupe); return id; }
  catch(e) { if(!dedupe) throw e; const old=db.prepare("SELECT id FROM jobs WHERE queue=? AND dedupe=? AND status IN ('queued','running')").get(queue,dedupe); if(!old) throw e; return old.id; }
}
function cancel(id) {
  const job=get(id); if(!job) throw Error('Unknown job');
  if(job.status==='queued') db.prepare("UPDATE jobs SET status='cancelled',ended=? WHERE id=? AND status='queued'").run(Date.now(),id);
  else if(job.status==='running') db.prepare("UPDATE jobs SET status='cancelling' WHERE id=? AND status='running'").run(id);
}
async function follow(id) {
  let offsets={stdout:0,stderr:0}; let interrupted=false;
  const stop=()=>{interrupted=true; cancel(id);};
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
      process.exitCode=job.code??(job.status==='cancelled'?130:1); return;
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
async function worker() {
  const lock=join(root,'worker.lock');
  // An atomic mkdir-based owner lock is maintained by the long-lived worker.
  const {mkdirSync,rmSync}=await import('node:fs');
  try{mkdirSync(lock);}catch{const prior=Number(existsSync(join(lock,'pid'))?readFileSync(join(lock,'pid'),'utf8'):0);if(prior && alive(prior)) throw Error('Queue worker already running; no second worker allowed'); rmSync(lock,{recursive:true,force:true});mkdirSync(lock);}
  writeFileSync(join(lock,'pid'),String(process.pid));
  const cleanup=()=>{try{rmSync(lock,{recursive:true});}catch{}};
  process.once('exit',cleanup);process.once('SIGTERM',()=>process.exit(0));process.once('SIGINT',()=>process.exit(0));
  const recover=db.prepare("SELECT * FROM jobs WHERE status IN ('running','cancelling')").all();
  for(const job of recover) {await reap(job.pid);db.prepare("UPDATE jobs SET status='queued',pid=NULL,started=NULL WHERE id=?").run(job.id);}
  for(;;) {
    const job=db.prepare("SELECT * FROM jobs WHERE status='queued' ORDER BY created,id LIMIT 1").get();
    if(!job){await sleep(150);continue;}
    const updated=db.prepare("UPDATE jobs SET status='running',started=? WHERE id=? AND status='queued'").run(Date.now(),job.id);
    if(!updated.changes) continue;
    const [program,...argv]=JSON.parse(job.command);
    const out=openSync(logPath(job.id,'stdout'),'w',0o600), err=openSync(logPath(job.id,'stderr'),'w',0o600);
    let child, code=1, signal=null, reason=null;
    try {
      child=spawn(program,argv,{cwd:job.cwd,stdio:['ignore',out,err],detached:true,env:process.env,shell:false});
      await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
      db.prepare('UPDATE jobs SET pid=? WHERE id=?').run(child.pid,job.id);
      const result=await new Promise(resolve=>{
        child.once('close',(c,s)=>resolve({code:c,signal:s}));
        const timer=setInterval(async()=>{
          const latest=get(job.id);
          if(latest.status==='cancelling'||Date.now()-latest.started>job.timeout) {
            clearInterval(timer); reason=latest.status==='cancelling'?'cancelled':'timeout';
            try{await reap(child.pid);}catch(e){reason=e.message;}
          }
        },150);
        child.once('close',()=>clearInterval(timer));
      });
      code=result.code??(reason==='cancelled'?130:124);signal=result.signal;
    } catch(e){reason=e.message;}
    finally {closeSync(out);closeSync(err);}
    db.prepare('UPDATE jobs SET status=?,ended=?,code=?,signal=?,error=? WHERE id=?').run(reason==='cancelled'?'cancelled':code===0?'completed':'failed',Date.now(),code,signal,reason,job.id);
  }
}
try {
  if(args[0]==='worker') await worker();
  else if(args[0]==='run' || args[0]==='submit') {const id=enqueue();if(args[0]==='submit') console.log(id);else await follow(id);}
  else if(args[0]==='status') console.log(JSON.stringify(db.prepare('SELECT queue,status,count(*) AS count FROM jobs GROUP BY queue,status').all(),null,2));
  else if(args[0]==='list') console.log(JSON.stringify(db.prepare('SELECT id,queue,status,created,started,ended,code,error FROM jobs ORDER BY created DESC LIMIT 30').all(),null,2));
  else if(args[0]==='cancel') { if(!args[1]) throw Error('cancel ID');cancel(args[1]);}
  else throw Error('Commands: worker | run | submit | status | list | cancel ID');
} catch(e) { console.error(e.message);process.exitCode=1; }
