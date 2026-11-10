import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {existsSync} from 'node:fs';
import {GpuError,exec,uid} from '../common.mjs';
import {hfRate,cancelHf,hfRunArgs} from '../providers/hf.mjs';
import {runningInstances,offerCandidates,cleanupVast} from '../providers/vast.mjs';
import {saveSession} from './store.mjs';

// All timeouts are absolute, never extended by browser activity. HF enforces
// a server-side deadline; Vast also uses the detached Node watchdog.
export function reserveBudget(config){
  if(config.provider==='hf'){
    const rate=hfRate(config.flavor||'l4x1');
    if(rate*config.seconds/3600+.25>config.budget)throw new GpuError('HF estimated session cost exceeds configured budget');
    return {rate};
  }
  const choices=offerCandidates({...config,gpu:config.gpu||'RTX 4090',disk:config.disk||80,
    maxHourly:config.maxHourly||.85,countries:config.countries||['US','CA']});
  if(!choices.length)throw new GpuError('No suitable Vast GPU available');
  const offer=choices[0];
  if(offer.dph_total*config.seconds/3600+1>config.budget)throw new GpuError('Vast estimated session cost exceeds configured budget');
  return {rate:offer.dph_total,offerId:offer.id};
}
export function hfWebArgs(config,label){
  return hfRunArgs({image:config.image,flavor:config.flavor||'l4x1',
    maxSeconds:config.seconds,name:label});
}
export async function createProviderSession(name,config,reserved,record){
  const label='neo-gpu-web-'+uid();
  record.label=label;saveSession(name,record);
  if(config.provider==='hf'){
    const call=exec('hf',hfWebArgs(config,label),{timeout:55000,allowFailure:true});
    if(call.status!==0){
      if(/402 Payment Required|403 Forbidden|401 Unauthorized|Pre-paid credit balance is insufficient/.test(call.stderr||''))throw new GpuError('HF rejected web Job; check billing and permission');
      // Indeterminate create! Stop any retry; user must reconcile by label.
      record.phase='unreconciled';record.label=label;saveSession(name,record);
      throw new GpuError('HF Job creation uncertain; reconcile label '+label);
    }
    const id=call.stdout.trim();
    if(!/^[a-f\d]{24}$/.test(id)){
      record.phase='unreconciled';record.label=label;saveSession(name,record);
      throw new GpuError('HF create returned no valid ID; reconcile label '+label);
    }
    return {jobId:id,label,rate:reserved.rate};
  }
  if(runningInstances().some(x=>String(x.label||'').startsWith('neo-gpu-')))
    throw new GpuError('An existing Neo Vast GPU instance must be reconciled first');
  const cmd='nohup /opt/neo-gpu/node /opt/neo-gpu/launcher.mjs > /tmp/neo-gpu-web.log 2>&1 < /dev/null &';
  const call=exec('vastai',['create','instance',String(reserved.offerId),'--image',config.image,
    '--disk',String(config.disk||80),'--ssh','--direct','--onstart-cmd',cmd,
    '--cancel-unavail','--label',label,'--raw'],{timeout:55000,allowFailure:true});
  if(call.status!==0){record.phase='unreconciled';record.label=label;saveSession(name,record);throw new GpuError('Vast creation uncertain; reconcile '+label);}
  let result;try{result=JSON.parse(call.stdout);}catch{}
  if(!Number.isSafeInteger(result?.new_contract)){
    record.phase='unreconciled';record.label=label;saveSession(name,record);throw new GpuError('Vast returned invalid contract; reconcile '+label);
  }
  return {instanceId:result.new_contract,label,rate:reserved.rate};
}
export async function destroyProviderSession(state){
  if(state.provider==='hf'){
    if(!/^[a-f0-9]{24}$/.test(state.jobId||''))throw new GpuError('No HF Job ID to cancel');
    return await cancelHf(state.jobId);
  }
  if(state.provider==='vast')return await cleanupVast(state);
  throw new GpuError('Unsupported GPU provider');
}
export function spawnWatchdog(name){
  const script=new URL('./watchdog.mjs',import.meta.url).pathname;
  const child=spawn(process.execPath,[script,name],{stdio:'ignore',detached:true,env:process.env});
  child.unref();return child.pid;
}

export async function reconcileUnknown(state){
  if(!state.label)throw new GpuError('Cannot reconcile unknown web resource without label');
  if(state.provider==='hf'){
    const list=JSON.parse(exec('hf',['jobs','ls','--name',state.label,'--json'],{timeout:25000}).stdout);
    if(!Array.isArray(list))throw new GpuError('Invalid HF job listing');
    const resources=list.filter(x=>x.name===state.label&&['SCHEDULING','RUNNING'].includes(typeof x.status==='string'?x.status:x.status?.stage));
    for(const row of resources){if(!/^[a-f0-9]{24}$/.test(row.id))throw new GpuError('HF job ID invalid');await cancelHf(row.id);}
    return 'reconciled';
  }
  if(state.provider==='vast'){
    const resources=runningInstances().filter(x=>x.label===state.label);
    for(const row of resources)await cleanupVast({...state,instanceId:row.id});
    return 'reconciled';
  }
  throw new GpuError('Unknown provider');
}
