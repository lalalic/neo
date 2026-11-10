import {GpuError,exec,integer,money,leaseSave,leasePath,uid,pause} from '../common.mjs';
import {proxy,runService} from '../transport.mjs';

export function hfRate(flavor){
  const rows=JSON.parse(exec('hf',['jobs','hardware','--json'],{timeout:25000}).stdout);
  const row=rows.find(x=>x.name===flavor);
  if(!row)throw new GpuError(`HF GPU flavor unavailable: ${flavor}`);
  const rate=Number(String(row['cost/hour']).replace('$',''));
  if(!Number.isFinite(rate)||rate<=0)throw new GpuError('Invalid HF hourly rate');
  return rate;
}
export function hfStatus(jobId){
  const rows=JSON.parse(exec('hf',['jobs','inspect',jobId,'--json'],{timeout:25000}).stdout);
  const row=Array.isArray(rows)?rows[0]:rows;
  return row?.status?.stage || row?.status || '';
}
export async function cancelHf(jobId){
  exec('hf',['jobs','cancel',jobId],{timeout:25000,allowFailure:true});
  for(let i=0;i<8;i++){
    try{const status=hfStatus(jobId);if(['CANCELED','COMPLETED','FAILED','ERROR','TIMED_OUT'].includes(status))return status;}
    catch{}
    await pause(2000);
  }
  throw new GpuError(`HF Job cancellation not verified: ${jobId}`);
}
export async function hfRun(plan){
  const {image,flavor,maxSeconds,budget,inputs,outputs}=plan;
  const rate=hfRate(flavor);
  if(rate*maxSeconds/3600+.25>budget)throw new GpuError('HF estimated cost exceeds budget; no Job created');
  const lease=leasePath(uid());
  const data={provider:'hf',phase:'creating',image,deadline:Date.now()+maxSeconds*1000,createdAt:new Date().toISOString()};
  leaseSave(lease,data);
  let jobId=null,confirmedRejected=false;
  try{
    const label='neo-gpu-'+uid();
    const call=exec('hf',['jobs','run','--flavor',flavor,'--timeout',`${maxSeconds}s`,
      '--attempts','1','--expose','8000','--detach','--format','quiet','--name',label,image],
      {timeout:50000,allowFailure:true});
    if(call.status!==0){
      if(/402 Payment Required|Pre-paid credit balance is insufficient|403 Forbidden|401 Unauthorized/.test(call.stderr||''))confirmedRejected=true;
      throw new GpuError('HF Job creation rejected (check billing, image accessibility, and job.write permission)');
    }
    jobId=call.stdout.trim();
    if(!/^[a-f\d]{24}$/.test(jobId))throw new GpuError('HF create response missing Job ID; reconcile by label before retry');
    Object.assign(data,{phase:'running',jobId,label});leaseSave(lease,data);
    console.log(JSON.stringify({phase:'hf_job_created',jobId,rate,lease}));
    const results=await runService(proxy(jobId),inputs,outputs,data.deadline);
    console.log(JSON.stringify({event:'NEO_GPU_RUN_PASS',provider:'hf',jobId,outputs:results}));
    return {jobId,outputs:results};
  }finally{
    if(jobId&&/^[a-f\d]{24}$/.test(jobId)){
      const status=await cancelHf(jobId);
      Object.assign(data,{phase:'destroyed',terminalStatus:status});leaseSave(lease,data);
      console.log(JSON.stringify({phase:'hf_job_cleaned',jobId,status}));
    }else if(confirmedRejected){Object.assign(data,{phase:'destroyed',terminalStatus:'create_rejected'});leaseSave(lease,data);}
    else{data.phase='unreconciled_create';leaseSave(lease,data);}
  }
}
