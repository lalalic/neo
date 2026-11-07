import {spawn} from 'node:child_process';
import {homedir} from 'node:os';
import {join, isAbsolute, resolve} from 'node:path';
import {mkdirSync, lstatSync} from 'node:fs';

const LOCK_HELPER = String.raw`
import fcntl
import os
import select
import stat
import sys
import time

path = sys.argv[1]
wait_seconds = float(sys.argv[2])
flags = os.O_RDWR | os.O_CREAT
if hasattr(os, 'O_CLOEXEC'):
    flags |= os.O_CLOEXEC
if hasattr(os, 'O_NOFOLLOW'):
    flags |= os.O_NOFOLLOW
fd = os.open(path, flags, 0o600)
try:
    if not stat.S_ISREG(os.fstat(fd).st_mode):
        raise RuntimeError('lock is not a regular file')
    if os.fstat(fd).st_uid != os.getuid():
        raise RuntimeError('lock is not owned by current user')
    os.fchmod(fd, 0o600)
    deadline = time.monotonic() + wait_seconds
    while True:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            break
        except (BlockingIOError, InterruptedError):
            if time.monotonic() >= deadline:
                sys.stdout.write('TIMEOUT\n')
                sys.stdout.flush()
                sys.exit(75)
            # If the Neo caller disappears while queued, exit and never
            # acquire an orphan lock after it has already left.
            if select.select([sys.stdin], [], [], 0.15)[0]:
                if not os.read(0, 1):
                    sys.exit(0)
    sys.stdout.write('ACQUIRED\n')
    sys.stdout.flush()
    # Track owned inference-server PIDs, so a killed Neo caller cannot
    # release the lock while a large orphan model is still resident.
    owned = set()
    pending = b''
    while True:
        data = os.read(0, 4096)
        if not data:
            break
        pending += data
        while b'\n' in pending:
            line, pending = pending.split(b'\n', 1)
            if line.startswith(b'PID '):
                try:
                    pid = int(line[4:])
                    if pid > 1:
                        owned.add(pid)
                except ValueError:
                    pass
    if owned:
        import signal
        def alive(pid):
            try:
                os.kill(pid, 0)
                return True
            except ProcessLookupError:
                return False
            except PermissionError:
                return False
        for pid in owned:
            if alive(pid):
                try:
                    os.kill(pid, signal.SIGTERM)
                except (ProcessLookupError, PermissionError):
                    pass
        deadline = time.monotonic() + 6.0
        while time.monotonic() < deadline and any(alive(pid) for pid in owned):
            time.sleep(0.1)
        for pid in owned:
            if alive(pid):
                try:
                    os.kill(pid, signal.SIGKILL)
                except (ProcessLookupError, PermissionError):
                    pass
finally:
    os.close(fd)
`;

const DEFAULT_LOCK_DIR = join(homedir(), '.local/state/neo/escalation');
const DEFAULT_WAIT_SECONDS = 3600;

function validateLockDir(dir) {
  if (typeof dir !== 'string' || !isAbsolute(dir)) {
    throw new Error('NEO_ESCALATION_LOCK_DIR must be an absolute path');
  }
  const folder = resolve(dir);
  mkdirSync(folder, {recursive:true,mode:0o700});
  const stats=lstatSync(folder);
  if(!stats.isDirectory() || stats.isSymbolicLink()) throw new Error('Escalation lock directory must be a real directory');
  if((stats.mode & 0o077)!==0) throw new Error('Escalation lock directory must have mode 0700');
  return folder;
}

export function escalationLockConfig(env=process.env) {
  const folder=env.NEO_ESCALATION_LOCK_DIR || DEFAULT_LOCK_DIR;
  const raw=env.NEO_ESCALATION_LOCK_WAIT_SECONDS || String(DEFAULT_WAIT_SECONDS);
  if(!/^\d+$/.test(raw)) throw new Error('NEO_ESCALATION_LOCK_WAIT_SECONDS must be an integer');
  const waitSeconds=Number(raw);
  if(!Number.isSafeInteger(waitSeconds) || waitSeconds<1 || waitSeconds>14400) {
    throw new Error('NEO_ESCALATION_LOCK_WAIT_SECONDS must be between 1 and 14400');
  }
  return {dir:folder, waitSeconds};
}

/**
 * Cross-process exclusive lock around one escalation. Python fcntl/flock
 * provides atomic advisory locking; an OS child holds the file descriptor,
 * and its stdin is tethered to this Node process. A crash cannot strand it.
 *
 * Every CLI escalation and the CLI health test use this function. Case
 * listings are read-only and do not acquire the inference resource lock.
 */
export async function withGlobalEscalationLock(fn,{
  dir=DEFAULT_LOCK_DIR,
  waitSeconds=DEFAULT_WAIT_SECONDS,
  python='/usr/bin/python3',
  onWaiting=()=>{},
}={}) {
  if(typeof fn!=='function') throw new Error('Escalation lock requires a callback');
  if(!Number.isSafeInteger(waitSeconds) || waitSeconds<1 || waitSeconds>14400) {
    throw new Error('Invalid escalation lock waitSeconds');
  }
  const path=join(validateLockDir(dir),'inference.lock');
  const child=spawn(python,['-u','-c',LOCK_HELPER,path,String(waitSeconds)],{
    stdio:['pipe','pipe','pipe'],
  });
  let stdout='';
  let stderr='';
  let settled=false;
  let ready=false;
  const childClosed=new Promise(resolve=>child.once('close',resolve));
  const waitingTimer=setTimeout(()=>{if(!ready)onWaiting();},1200);
  let acquired;
  try {
    acquired=await new Promise((resolveReady,rejectReady)=>{
      const finish=(value,error)=>{
        if(settled)return;
        settled=true;
        clearTimeout(waitingTimer);
        if(error)rejectReady(error);
        else resolveReady(value);
      };
      child.stderr.on('data',data=>{stderr=(stderr+data.toString()).slice(-1200);});
      child.stdout.on('data',chunk=>{
        stdout=(stdout+chunk.toString()).slice(-100);
        if(stdout.includes('ACQUIRED\n')){ready=true;finish(true);}
        else if(stdout.includes('TIMEOUT\n'))finish(false);
      });
      child.once('error',error=>finish(undefined,new Error('Neo escalation lock helper failed: '+error.message)));
      child.once('close',code=>finish(undefined,new Error(
        'Neo escalation lock helper exited before acquisition (code '+code+'): '+stderr.trim().slice(-180)
      )));
    });
    if(!acquired)throw new Error('Neo escalation is busy: global model lock timed out after '+waitSeconds+'s');
    const registerOwnedPid = pid => {
      if(!Number.isSafeInteger(pid) || pid < 2) throw Error('Invalid inference server PID');
      if(child.stdin.destroyed) throw Error('Resource lock helper exited before PID registration');
      child.stdin.write('PID '+pid+'\n');
    };
    return await fn({registerOwnedPid});
  } finally {
    clearTimeout(waitingTimer);
    child.stdin.end();
    const timeout=setTimeout(()=>child.kill('SIGKILL'),2500);
    try { await childClosed; } finally {clearTimeout(timeout);}
  }
}
