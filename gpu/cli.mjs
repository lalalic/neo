#!/usr/bin/env node
// Built-in Neo GPU CLI. Provider adapters contain rental logic only; image
// construction and the container's HTTP execution contract are shared.
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {GpuError,exec,parse,integer,money,findService,serviceRegistry,ensureLeasePath,readJson,leaseSave} from './common.mjs';
import {bindings} from './transport.mjs';
import {build} from './image.mjs';
import {hfRun,cancelHf} from './providers/hf.mjs';
import {vastRun,cleanupVast} from './providers/vast.mjs';
import {webMain} from './web/manager.mjs';

export const usage = `Neo GPU — built into Neo (Node.js)
  neo gpu build [--project ROOT] [--dockerfile Dockerfile] [--name SERVICE]
                [--builder github|local] [--image ghcr.io/OWNER/NAME:TAG]
                [--push] [--dry-run]
  neo gpu run SERVICE [--provider hf|vast] --input NAME=PATH ...
                --output NAME=PATH ... --allow-spend --allow-upload
                [--budget USD] [--max-seconds 1200] [--dry-run]
  neo gpu run --image ghcr.io/OWNER/NAME:TAG [options]
  neo gpu services
  neo gpu web add SERVICE | remove SERVICE | token SERVICE | rotate SERVICE | status [SERVICE]
  neo gpu web start SERVICE --allow-spend | stop SERVICE | serve [--port 8798]
  neo gpu doctor
  neo gpu cleanup --lease PATH

Container contract: image CMD/ENTRYPOINT reads /neo/input and writes /neo/output.
No project-specific HTTP server or separate neo-gpu installation is required.
`;
export function planRun(args){
  const opts=parse(args,{values:['--image','--provider','--flavor','--budget','--max-seconds','--gpu',
    '--disk','--max-hourly','--countries','--ssh-key'],multi:['--input','--output'],
    switches:['--allow-spend','--allow-upload','--dry-run']});
  if(opts._.length>1)throw new GpuError('Provide at most one service name');
  const service=opts._[0];
  const saved=service?findService(service):null;
  if(service&&!saved)throw new GpuError(`Unknown GPU service ${service}; run neo gpu build first`);
  const image=opts.image||saved?.image;
  if(!image || !/^ghcr\.io\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+:[a-zA-Z0-9_.-]+$/.test(image))throw new GpuError('A versioned GHCR image is required');
  const provider=opts.provider||'hf';
  if(!['hf','vast'].includes(provider))throw new GpuError('Provider must be hf or vast');
  const inputs=bindings(opts.input,'input'),outputs=bindings(opts.output,'output');
  if(!outputs.length)throw new GpuError('At least one --output NAME=PATH is required');
  if(new Set(inputs.map(x=>x.name)).size!==inputs.length || new Set(outputs.map(x=>x.name)).size!==outputs.length)
    throw new GpuError('Duplicate input or output name');
  const maxSeconds=integer(opts.max_seconds||'1200','--max-seconds',{min:180,max:1800});
  const budget=money(opts.budget||'2','--budget',{max:5});
  return {image,service,provider,inputs,outputs,maxSeconds,budget,
    flavor:opts.flavor||'l4x1',gpu:opts.gpu||'RTX 4090',
    disk:integer(opts.disk||'80','--disk',{min:40,max:500}),
    maxHourly:money(opts.max_hourly||'.85','--max-hourly',{max:5}),
    countries:(opts.countries||'US,CA').split(','),sshKey:opts.ssh_key||undefined,
    dryRun:!!opts.dry_run,allowSpend:!!opts.allow_spend,allowUpload:!!opts.allow_upload};
}
export async function run(args){
  const plan=planRun(args);
  if(plan.dryRun){console.log(JSON.stringify({mode:'dry_run',...plan},null,2));return;}
  if(!plan.allowSpend)throw new GpuError('Paid GPU rental requires --allow-spend');
  if(plan.inputs.length&&!plan.allowUpload)throw new GpuError('Private inputs require --allow-upload');
  if(plan.provider==='hf')await hfRun(plan);else await vastRun(plan);
}
export function doctor(){
  const cmd=tool=>{try{return exec(tool,['--version'],{allowFailure:true,timeout:5000}).status===0;}catch{return false;}};
  const data={node:process.version,localContainerRuntime:cmd(process.env.NEO_GPU_CONTAINER_ENGINE||'docker'),
    hfCli:cmd('hf'),vastCli:cmd('vastai'),githubCli:cmd('gh'),
    serviceCount:Object.keys(serviceRegistry().services).length};
  console.log(JSON.stringify(data,null,2));
}
export async function cleanup(args){
  const opts=parse(args,{values:['--lease']});
  if(!opts.lease||opts._.length)throw new GpuError('usage: neo gpu cleanup --lease ABSOLUTE_PATH');
  const file=ensureLeasePath(opts.lease);
  const lease=readJson(file);
  if(!lease)throw new GpuError('GPU lease does not exist');
  if(lease.phase==='destroyed'){console.log(JSON.stringify({phase:'destroyed',already:true}));return;}
  const status=lease.provider==='hf' ? await cancelHf(lease.jobId) :
    lease.provider==='vast' ? await cleanupVast(lease) : null;
  if(!status)throw new GpuError('Unsupported GPU lease');
  lease.phase='destroyed';lease.terminalStatus=status;leaseSave(file,lease);
  console.log(JSON.stringify({phase:'destroyed',terminalStatus:status}));
}
export async function main(args=process.argv.slice(2)){
  const [cmd,...rest]=args;
  try{
    if(!cmd||['help','--help','-h'].includes(cmd)){console.log(usage);return 0;}
    switch(cmd){
      case 'build':await build(rest);break;
      case 'web':await webMain(rest);break;
      case 'run':await run(rest);break;
      case 'services':if(rest.length)throw new GpuError('usage: neo gpu services');
        console.log(JSON.stringify(serviceRegistry(),null,2));break;
      case 'doctor':if(rest.length)throw new GpuError('usage: neo gpu doctor');doctor();break;
      case 'cleanup':await cleanup(rest);break;
      default:throw new GpuError(`Unknown neo gpu command: ${cmd}`);
    }
    return 0;
  }catch(error){console.error('GPU ERROR:',error instanceof Error?error.message:String(error));return 2;}
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(new URL(import.meta.url).pathname)){
  process.exitCode=await main();
}
