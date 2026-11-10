import {spawnSync} from 'node:child_process';
import {readFileSync, writeFileSync, mkdirSync, renameSync, existsSync, chmodSync} from 'node:fs';
import {homedir} from 'node:os';
import {join, dirname, resolve} from 'node:path';
import {randomBytes} from 'node:crypto';

export class GpuError extends Error {}
export const stateDir = () => process.env.NEO_GPU_STATE_DIR || join(homedir(),'.local','state','neo','gpu');
export const registryFile = () => process.env.NEO_GPU_REGISTRY_FILE || join(homedir(),'.config','neo','gpu','services.json');
export const uid = () => randomBytes(9).toString('hex');
export const pause = ms => new Promise(r=>setTimeout(r,ms));
export function exec(exe,args,options={}) {
  const result=spawnSync(exe,args,{encoding:'utf8',timeout:options.timeout ?? 60000,
    maxBuffer:6*1024*1024,cwd:options.cwd,env:options.env??process.env});
  if (result.error) throw new GpuError(`${exe}: ${result.error.code || result.error.message}`);
  if (result.status!==0 && !options.allowFailure) throw new GpuError(`${exe} ${args[0]??''} failed (exit ${result.status}): ${(result.stderr||'').slice(-400)}`);
  return result;
}
export function parse(args, {values=[],switches=[],multi=[]}={}) {
  const single=new Set(values),bool=new Set(switches),array=new Set(multi);
  const out={_:[]};
  for(let i=0;i<args.length;i++) {
    const k=args[i];
    if(!k.startsWith('--')) {out._.push(k);continue;}
    if(bool.has(k)){out[k.slice(2).replaceAll('-','_')]=true;continue;}
    if(!single.has(k)&&!array.has(k))throw new GpuError(`Unknown option ${k}`);
    const v=args[++i];
    if(!v||v.startsWith('--'))throw new GpuError(`Missing value for ${k}`);
    const key=k.slice(2).replaceAll('-','_');
    if(array.has(k))(out[key]??=[]).push(v);
    else {if(key in out)throw new GpuError(`Repeated option ${k}`);out[key]=v;}
  }
  return out;
}
export function integer(value,label,{min=0,max=1000000}={}) {
  const n=Number(value);
  if(!Number.isSafeInteger(n)||n<min||n>max)throw new GpuError(`${label} must be an integer in [${min}, ${max}]`);
  return n;
}
export function money(value,label,{min=0,max=1000}={}) {
  const n=Number(value);
  if(!Number.isFinite(n)||n<=min||n>max)throw new GpuError(`${label} must be >${min} and <=${max}`);
  return n;
}
export function atomicJson(path,obj) {
  mkdirSync(dirname(path),{recursive:true,mode:0o700});
  const temp=path+'.'+uid()+'.tmp';
  writeFileSync(temp,JSON.stringify(obj,null,2)+'\n',{flag:'wx',mode:0o600});
  chmodSync(temp,0o600);renameSync(temp,path);
}
export function readJson(path,fallback=null) {
  if(!existsSync(path))return fallback;
  try{return JSON.parse(readFileSync(path,'utf8'));}catch {throw new GpuError(`Invalid JSON state: ${path}`);}
}
export function serviceRegistry(){return readJson(registryFile(),{version:1,services:{}});}
export function saveService(name,info){
  const data=serviceRegistry();data.services[name]=info;atomicJson(registryFile(),data);
}
export function findService(name){return serviceRegistry().services[name]||null;}
export function leasePath(id){return join(stateDir(),`lease-${id}.json`);}
export function leaseSave(path,data){atomicJson(path,data);}
export function ensureLeasePath(path){
  const full=resolve(path),base=resolve(stateDir());
  if(dirname(full)!==base||!/^lease-[a-f\d]{18}\.json$/.test(full.split('/').at(-1)))throw new GpuError('Invalid GPU lease path');
  return full;
}
