import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {GpuError,exec,uid,leasePath,leaseSave,pause} from '../common.mjs';
import {localProxy,runService} from '../transport.mjs';
import {fileURLToPath} from 'node:url';

const here=fileURLToPath(import.meta.url);
function vast(...args){return exec('vastai',[...args,'--raw'],{timeout:45000});}
function runningInstances(){const d=JSON.parse(vast('show','instances').stdout);return Array.isArray(d)?d:[];}
function offerCandidates(options){
  const key=options.gpu.replaceAll(' ','_');
  const rows=JSON.parse(vast('search','offers',`gpu_name=${key} num_gpus=1 rentable=true`).stdout);
  if(!Array.isArray(rows))throw new GpuError('Invalid Vast.ai offers response');
  return rows.filter(x=>x.gpu_name===options.gpu&&x.num_gpus===1&&x.rentable&&x.verification==='verified'&&
    Number(x.reliability2)>=0.98&&Number(x.gpu_ram)>=20000&&Number(x.cpu_ram)>=32000&&
    Number(x.disk_space)>=options.disk&&Number(x.dph_total)>0&&Number(x.dph_total)<=options.maxHourly&&
    Number(String(x.driver_version||'').split('.')[0])>=560&&
    (!options.countries.length||options.countries.includes(String(x.geolocation||'').split(',').at(-1).trim()))
  ).sort((a,b)=>a.dph_total-b.dph_total);
}
function destroy(id){exec('vastai',['destroy','instance',String(id),'-y'],{timeout:55000,allowFailure:true});
  if(runningInstances().some(x=>Number(x.id)===Number(id)))throw new GpuError(`Vast.ai destroy not verified: ${id}`);
}
export async function cleanupVast(lease){
  const id=lease.instanceId;
  if(Number.isInteger(id)&&id>0) destroy(id);
  else if(lease.label){
    const matches=runningInstances().filter(x=>x.label===lease.label);
    for(const match of matches)destroy(match.id);
    if(!matches.length)throw new GpuError('Vast creation unconfirmed; keep lease for later reconciliation');
  }else throw new GpuError('Vast lease missing instance identifier/label');
  return 'destroyed';
}
function freePort(){return new Promise((resolve,reject)=>{const server=createServer();server.once('error',reject);
  server.listen(0,'127.0.0.1',()=>{const p=server.address().port;server.close(()=>resolve(p));});});}
async function tunnelFor(id,deadline,keyFile){
  let endpoint=null;
  while(Date.now()<deadline){
    try{
      const ssh=exec('vastai',['ssh-url',String(id)],{timeout:15000}).stdout.trim();
      const url=new URL(ssh);
      if(url.protocol==='ssh:'&&url.hostname&&Number(url.port)>0&&Number(url.port)<=65535&&
         /^[a-zA-Z0-9_.-]+$/.test(url.username||'root')){endpoint=url;break;}
    }catch{}
    await pause(4000);
  }
  if(!endpoint)throw new GpuError('Vast SSH destination unavailable');
  const user=endpoint.username||'root';
  for(let n=0;n<45&&Date.now()<deadline;n++){
    const port=await freePort();
    const child=spawn('ssh',['-N','-T','-i',keyFile,'-p',endpoint.port,'-o','BatchMode=yes',
      '-o','ConnectTimeout=8','-o','ServerAliveInterval=8','-o','ServerAliveCountMax=3',
      '-o','StrictHostKeyChecking=accept-new','-o',`HostKeyAlias=vast-${id}`,
      '-L',`127.0.0.1:${port}:127.0.0.1:8000`,`${user}@${endpoint.hostname}`],
      {stdio:'ignore'});
    const request=localProxy(port);
    for(let probe=0;probe<3;probe++){
      await pause(2000);
      if(child.exitCode!==null)break;
      try{const data=await(await request('/health',{timeout:2000})).json();
        if(data.ok===true&&data.service==='neo-gpu-v1')return {request,tunnel:child};}
      catch{}
    }
    child.kill();
    await pause(3000);
  }
  throw new GpuError('Vast SSH tunnel/service unavailable');
}
export async function vastRun(plan){
  const {image,maxSeconds,budget,inputs,outputs}=plan;
  if(runningInstances().some(x=>String(x.label||'').startsWith('neo-gpu-')))
    throw new GpuError('Another Neo GPU Vast instance exists; clean it before renting');
  const candidates=offerCandidates(plan);
  if(!candidates.length)throw new GpuError('No verified Vast GPU offer meets hardware/price constraints');
  const best=candidates[0];
  if(best.dph_total*maxSeconds/3600+1>budget)throw new GpuError('Vast cost estimate + safety margin exceeds budget');
  const label='neo-gpu-'+uid();
  const path=leasePath(uid());
  const data={provider:'vast',label,phase:'creating',image,deadline:Date.now()+maxSeconds*1000,
    rate:best.dph_total,createdAt:new Date().toISOString()};
  leaseSave(path,data);
  let tunnel=null;
  try{
    // Vast's ssh mode launches sshd; onstart starts the generic Neo service.
    // The runtime command is already embedded in the image at build time.
    const cmd='nohup /opt/neo-gpu/node /opt/neo-gpu/service.mjs > /tmp/neo-gpu-service.log 2>&1 < /dev/null &';
    const p=vast('create','instance',String(best.id),'--image',image,'--disk',String(plan.disk),
      '--ssh','--direct','--onstart-cmd',cmd,'--cancel-unavail','--label',label);
    const created=JSON.parse(p.stdout);
    if(!Number.isInteger(created.new_contract))throw new GpuError('Vast create missing instance ID; reconcile by label');
    data.instanceId=created.new_contract;data.phase='running';leaseSave(path,data);
    console.log(JSON.stringify({phase:'vast_instance_created',instanceId:data.instanceId,rate:best.dph_total,lease:path}));
    // The rental is protected by an independent watchdog if Neo exits unexpectedly.
    const watchdog=spawn(process.execPath,[new URL('../watchdog.mjs',import.meta.url).pathname,path],
      {detached:true,stdio:'ignore',env:process.env});watchdog.unref();
    const keyFile=plan.sshKey||join(homedir(),'.ssh','id_ed25519');
    if(!existsSync(keyFile))throw new GpuError('Vast SSH private key not found');
    tunnel=await tunnelFor(data.instanceId,Math.min(data.deadline-120000,Date.now()+420000),keyFile);
    const results=await runService(tunnel.request,inputs,outputs,data.deadline);
    console.log(JSON.stringify({event:'NEO_GPU_RUN_PASS',provider:'vast',instanceId:data.instanceId,outputs:results}));
    return {instanceId:data.instanceId,outputs:results};
  }finally{
    tunnel?.tunnel?.kill();
    data.phase='cleanup_requested';leaseSave(path,data);
    try{await cleanupVast(data);data.phase='destroyed';leaseSave(path,data);
      console.log(JSON.stringify({phase:'vast_destroyed',instanceId:data.instanceId||null}));}
    catch(e){leaseSave(path,data);throw e;}
  }
}
