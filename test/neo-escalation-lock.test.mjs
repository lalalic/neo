import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {
  existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync,
  chmodSync, mkdirSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {withGlobalEscalationLock, escalationLockConfig} from '../.bin/neo-escalation-lock.mjs';

function fixture() {
  const root=mkdtempSync(join(tmpdir(),'neo-escalation-lock-test-'));
  const dir=join(root,'private-locks');
  return {root,dir,cleanup:()=>rmSync(root,{recursive:true,force:true})};
}
const sleep = ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('lock config provides one shared host path and validates queue timeout',()=>{
  const a=escalationLockConfig({});
  const b=escalationLockConfig({});
  assert.deepEqual(a,b);
  assert.equal(a.waitSeconds,3600);
  assert.match(a.dir,/neo\/escalation$/);
  assert.deepEqual(escalationLockConfig({
    NEO_ESCALATION_LOCK_DIR:'/tmp/neo-model-locks',
    NEO_ESCALATION_LOCK_WAIT_SECONDS:'3',
  }),{dir:'/tmp/neo-model-locks',waitSeconds:3});
  for(const bad of ['0','1.5','garbage','14401','-1']){
    assert.throws(()=>escalationLockConfig({NEO_ESCALATION_LOCK_WAIT_SECONDS:bad}),/LOCK_WAIT_SECONDS/);
  }
});

test('success, failure and private persistent lock file release',async()=>{
  const f=fixture();
  try {
    assert.equal(await withGlobalEscalationLock(async()=>42,{dir:f.dir}),42);
    await assert.rejects(withGlobalEscalationLock(async()=>{throw Error('original task failed')},{dir:f.dir}),/original task failed/);
    assert.equal(await withGlobalEscalationLock(async()=>true,{dir:f.dir}),true);
    assert.equal(lstatSync(f.dir).mode&0o777,0o700);
    assert.equal(lstatSync(join(f.dir,'inference.lock')).mode&0o777,0o600);
  } finally {f.cleanup();}
});

test('parallel invocations are serialized, no overlap while model slot is held',async()=>{
  const f=fixture();
  const order=[];
  let active=0;
  try {
    const first=withGlobalEscalationLock(async()=>{
      active++;
      order.push('first-start');
      await sleep(500);
      assert.equal(active,1);
      order.push('first-end');
      active--;
    },{dir:f.dir});
    await sleep(85);
    const second=withGlobalEscalationLock(async()=>{
      active++;
      assert.equal(active,1);
      order.push('second-start');
      active--;
    },{dir:f.dir});
    await Promise.all([first,second]);
    assert.deepEqual(order,['first-start','first-end','second-start']);
  } finally {f.cleanup();}
});

test('second process times out without entering callback, then succeeds when released',async()=>{
  const f=fixture();
  let release;
  let entered=0;
  try {
    const gate=new Promise(resolve=>{release=resolve;});
    let acquired;
    const started=new Promise(resolve=>{acquired=resolve;});
    const first=withGlobalEscalationLock(async()=>{acquired();await gate;},{dir:f.dir});
    await started;
    await assert.rejects(withGlobalEscalationLock(()=>{entered++;},{dir:f.dir,waitSeconds:1}),/timed out/);
    assert.equal(entered,0);
    release();
    await first;
    await withGlobalEscalationLock(async()=>{entered++;},{dir:f.dir});
    assert.equal(entered,1);
  } finally {release?.();f.cleanup();}
});

test('orphan lock is released when its Neo caller is killed',async()=>{
  const f=fixture();
  const moduleUrl=new URL('../.bin/neo-escalation-lock.mjs',import.meta.url).href;
  const program=`
    import {withGlobalEscalationLock} from ${JSON.stringify(moduleUrl)};
    await withGlobalEscalationLock(async()=>{process.stdout.write('HELD\\n');await new Promise(()=>{});},
      {dir:process.argv[1]});
  `;
  const child=spawn(process.execPath,['--input-type=module','-e',program,f.dir],{stdio:['ignore','pipe','pipe']});
  let stdout='';
  const exited=new Promise(resolve=>child.once('close',resolve));
  try {
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('child failed to acquire lock')),5000);
      child.stdout.on('data',data=>{
        stdout+=data.toString();
        if(stdout.includes('HELD\n')){clearTimeout(timer);resolve();}
      });
      child.once('error',reject);
      child.once('close',code=>{if(!stdout.includes('HELD\n'))reject(Error('child closed before lock '+code));});
    });
    child.kill('SIGKILL');
    await exited;
    assert.equal(await withGlobalEscalationLock(async()=> 'RECOVERED', {dir:f.dir,waitSeconds:5}),'RECOVERED');
  } finally {child.kill('SIGKILL');f.cleanup();}
});

test('reject public/symlink lock folder instead of storing locks in insecure location',async()=>{
  const f=fixture();
  try {
    mkdirSync(f.dir,{mode:0o755});
    chmodSync(f.dir,0o755);
    await assert.rejects(withGlobalEscalationLock(async()=>{throw Error('must not run')},{dir:f.dir}),/0700/);
    const link=join(f.root,'link');
    symlinkSync(f.dir,link);
    await assert.rejects(withGlobalEscalationLock(async()=>{}, {dir:link}),/real directory/);
  } finally {f.cleanup();}
});

test('caller crash cleans an owned orphan model before another escalation gets the lock', async()=>{
  const f=fixture();
  const moduleUrl=new URL('../.bin/neo-escalation-lock.mjs',import.meta.url).href;
  const program=`
    import {spawn} from 'node:child_process';
    import {withGlobalEscalationLock} from ${JSON.stringify(moduleUrl)};
    await withGlobalEscalationLock(async({registerOwnedPid})=>{
      const model=spawn('/bin/sleep',['30'],{stdio:'ignore'});
      registerOwnedPid(model.pid);
      process.stdout.write('MODEL '+model.pid+'\\n');
      await new Promise(()=>{});
    },{dir:process.argv[1]});
  `;
  const parent=spawn(process.execPath,['--input-type=module','-e',program,f.dir],{stdio:['ignore','pipe','pipe']});
  let output='';
  const exited=new Promise(resolve=>parent.once('close',resolve));
  let modelPid;
  try {
    modelPid=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('model process did not start')),5500);
      parent.stdout.on('data',chunk=>{
        output+=chunk.toString();
        const match=output.match(/MODEL (\d+)\n/);
        if(match){clearTimeout(timer);resolve(Number(match[1]));}
      });
      parent.once('error',reject);
    });
    assert.ok(modelPid>1);
    parent.kill('SIGKILL');
    await exited;
    const isAlive=()=>{
      try {process.kill(modelPid,0);return true;}
      catch(e){if(e.code==='ESRCH')return false;throw e;}
    };
    assert.equal(await withGlobalEscalationLock(async()=>isAlive(),{
      dir:f.dir,waitSeconds:10
    }),false,'owned model must be terminated before lock handoff');
  }finally{
    parent.kill('SIGKILL');
    if(modelPid){try{process.kill(modelPid,'SIGKILL');}catch{}}
    f.cleanup();
  }
});
