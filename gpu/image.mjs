import {createHash} from 'node:crypto';
import {existsSync,readFileSync,realpathSync} from 'node:fs';
import {resolve,relative,basename,join,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {GpuError,exec,parse,pause,saveService} from './common.mjs';

const here=resolve(fileURLToPath(import.meta.url),'..');
const runtime=resolve(here,'runtime');
const runtimeFiles=['service.mjs','web.mjs','launcher.mjs','Dockerfile.wrap'];
const safeImage=/^ghcr\.io\/[a-zA-Z0-9][a-zA-Z0-9_.-]*\/[a-zA-Z0-9_.-]+:[a-zA-Z0-9_.-]{1,100}$/;
function git(project,args){return exec('git',['-C',project,...args]).stdout.trim();}
function slug(name){return name.toLowerCase().replace(/[^a-z0-9-]+/g,'-').replace(/^-|-$/g,'') || 'app';}
function githubRemote(raw){
  const m= /^(?:git@github\.com:|https:\/\/github\.com\/)([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+?)(?:\.git)?$/.exec(raw);
  if(!m)throw new GpuError('GitHub build requires a GitHub origin remote');
  return {owner:m[1],repo:m[2]};
}
export function imagePlan(options={}) {
  const project=realpathSync(resolve(options.project||process.cwd()));
  const root=git(project,['rev-parse','--show-toplevel']);
  if(realpathSync(root)!==project) throw new GpuError('--project must be the Git repository root');
  const dockerfile=realpathSync(resolve(project,options.dockerfile||'Dockerfile'));
  const fileRel=relative(project,dockerfile);
  if(fileRel.startsWith('..'+sep)||fileRel==='..'||fileRel.startsWith('/')||!existsSync(dockerfile))throw new GpuError('Dockerfile must reside in the project repo');
  const sha=git(project,['rev-parse','HEAD']);
  const remote=githubRemote(git(project,['remote','get-url','origin']));
  const name=options.name||slug(remote.repo);
  if(!/^[a-z][a-z0-9-]{0,63}$/.test(name))throw new GpuError('Invalid service name');
  const mode=options.mode||'batch';
  if(!['batch','web'].includes(mode))throw new GpuError('GPU build mode must be batch or web');
  const appPort=Number(options.port||7860);
  if(!Number.isInteger(appPort)||appPort<1||appPort>65535||appPort===8000)throw new GpuError('Invalid web app port');
  const runtimeHash=runtimeFiles.reduce((hash,file)=>hash.update(readFileSync(join(runtime,file))),createHash('sha256')).digest('hex');
  const version=createHash('sha256').update(sha).update(readFileSync(dockerfile)).update(runtimeHash).update(mode).update(String(appPort)).update(name).digest('hex').slice(0,12);
  const image=options.image||`ghcr.io/${remote.owner.toLowerCase()}/${slug(remote.repo)}-gpu:sha-${version}`;
  if(!safeImage.test(image))throw new GpuError('Expected an explicit versioned ghcr.io image reference');
  const builder=options.builder||'github';
  if(options.push && options.no_push)throw new GpuError('--push and --no-push conflict');
  if(!['github','local'].includes(builder))throw new GpuError('--builder must be github or local');
  if(builder==='github') {
    if(!options.dry_run&&git(project,['status','--porcelain']).trim())throw new GpuError('Commit local project changes before hosted GitHub builds');
    if(!options.dry_run&&git(project,['rev-parse','@{u}'])!==sha) throw new GpuError('Push the source commit before hosted GitHub builds');
  }
  return {name,image,project,repository:`${remote.owner}/${remote.repo}`,commit:sha,dockerfile:fileRel,builder,push:!options.no_push,mode,appPort,runtimeHash,buildId:options.build_id||null};
}
function inspectCommand(engine,base){
  const raw=JSON.parse(exec(engine,['image','inspect',base],{timeout:20000}).stdout);
  const row=Array.isArray(raw)?raw[0]:raw;
  const config=row.Config||row.config||{};
  const entry=config.Entrypoint||config.EntrypointCmd||[];
  const cmd=config.Cmd||[];
  const command=[...(Array.isArray(entry)?entry:[]),...(Array.isArray(cmd)?cmd:[])];
  if(!command.length||command.some(x=>typeof x!=='string'))throw new GpuError('Project Dockerfile needs an executable CMD or ENTRYPOINT');
  return JSON.stringify(command);
}
function buildLocal(plan,engine){
  const base='neo-gpu-base:'+plan.image.split(':').at(-1);
  exec(engine,['build','--pull','-f',join(plan.project,plan.dockerfile),'-t',base,plan.project],{timeout:90*60*1000});
  const cmd=inspectCommand(engine,base);
  exec(engine,['build','-f',join(runtime,'Dockerfile.wrap'),'--build-context',`neo-runtime=${runtime}`,
    '--build-arg',`NEO_BASE_IMAGE=${base}`,'--build-arg',`NEO_GPU_CMD_JSON=${cmd}`,
    '--build-arg',`NEO_GPU_MODE=${plan.mode}`,'--build-arg',`NEO_GPU_APP_PORT=${plan.appPort}`,
    '--build-arg',`NEO_GPU_SERVICE_NAME=${plan.name}`,
    '-t',plan.image,plan.project],{timeout:90*60*1000});
  if(plan.push)exec(engine,['push',plan.image],{timeout:25*60*1000});
}
async function buildGithub(plan){
  const info=JSON.parse(exec('gh',['repo','view',plan.repository,'--json','isPrivate'],{timeout:20000}).stdout);
  if(info.isPrivate)throw new GpuError('Hosted Neo builder cannot read a different private project repository; use --builder local');
  const owner=plan.repository.split('/')[0].toLowerCase();
  if(!plan.image.startsWith('ghcr.io/'+owner+'/'))throw new GpuError('Hosted builds must publish under the project owner GHCR namespace');
  if(!/:[s]ha-[a-f0-9]{12}$/.test(plan.image))throw new GpuError('Hosted builds require immutable :sha-XXXXXXXXXXXX tags');
  if(!plan.push) throw new GpuError('Hosted builds publish an image: pass --push to authorize registry publication');
  const repo=process.env.NEO_GPU_BUILDER_REPO||'lalalic/neo';
  const buildId='ngpu-'+Date.now()+'-'+Math.random().toString(36).slice(2,8);
  exec('gh',['workflow','run','neo-gpu-image.yml','--repo',repo,'--ref','main',
    '-f',`repository=${plan.repository}`,'-f',`commit=${plan.commit}`,
    '-f',`dockerfile=${plan.dockerfile}`,'-f',`image=${plan.image}`,
    '-f',`build_id=${buildId}`,'-f',`runtime_hash=${plan.runtimeHash}`,'-f',`mode=${plan.mode}`,'-f',`app_port=${plan.appPort}`,'-f',`service_name=${plan.name}`],{timeout:30000});
  console.log(JSON.stringify({event:'image_build_dispatched',buildId,image:plan.image,repository:repo}));
  const deadline=Date.now()+50*60*1000;
  let runId=null;
  while(Date.now()<deadline){
    const rows=JSON.parse(exec('gh',['run','list','--repo',repo,'--workflow','neo-gpu-image.yml','--limit','20',
      '--json','databaseId,displayTitle,status,conclusion'],{timeout:20000}).stdout);
    const row=rows.find(x=>x.displayTitle?.includes(buildId));
    if(row){runId=row.databaseId;if(row.status==='completed'){
      if(row.conclusion!=='success')throw new GpuError(`Hosted image build failed: ${repo}/actions/runs/${runId}`);
      return {runId,url:`https://github.com/${repo}/actions/runs/${runId}`};
    }}
    await pause(8000);
  }
  throw new GpuError(`Build still running; check GitHub Actions using build ID ${buildId}`);
}
export async function build(args){
  const opts=parse(args,{values:['--project','--dockerfile','--name','--image','--builder','--mode','--port'],switches:['--push','--no-push','--dry-run']});
  if(opts._.length)throw new GpuError('usage: neo gpu build [--project ROOT] [--dockerfile PATH] [--push]');
  const plan=imagePlan(opts);
  if(opts.dry_run){console.log(JSON.stringify({mode:'dry_run',...plan},null,2));return;}
  if(plan.builder==='github')await buildGithub(plan);
  else buildLocal(plan,process.env.NEO_GPU_CONTAINER_ENGINE||'docker');
  saveService(plan.name,{image:plan.image,repository:plan.repository,project:plan.project,sourceCommit:plan.commit,createdAt:new Date().toISOString(),published:plan.push,mode:plan.mode,appPort:plan.appPort});
  console.log(JSON.stringify({event:'neo_gpu_service_built',service:plan.name,image:plan.image,published:plan.push}));
}
