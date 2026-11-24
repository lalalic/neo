// E2E driver adapter only; all Compute operations execute the Rust CLI.
import {execFileSync} from 'node:child_process';
import {writeFileSync,renameSync,rmSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
export const root=fileURLToPath(new URL('../../',import.meta.url));
export const nativeCli=process.env.NEO_CLI_BIN || 'neo';
function call(args,project=root){
  return JSON.parse(execFileSync(nativeCli,['compute',...args],{cwd:project,env:{...process.env,NEO_HARNESS_ROOT:root},encoding:'utf8',timeout:30000}));
}
export function imagePlan({project=root,dockerfile,mode,name,port}){
  return call(['build','--project',project,'--dockerfile',dockerfile,'--mode',mode,'--name',name,...(port?['--port',String(port)]:[]),'--dry-run'],project);
}
export function findService(name){return call(['services']).services[name];}
export function token(name){return call(['web','token',name]).token;}
export function atomicJson(path,value){
  const temp=path+'.'+randomUUID()+'.tmp';
  try{writeFileSync(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});renameSync(temp,path);}
  finally{rmSync(temp,{force:true});}
}
