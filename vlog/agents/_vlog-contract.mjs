import { readFile, realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';

export function inside(root, target) {
 const rel=relative(root,target);
 return rel!==''&&rel!=='..'&&!rel.startsWith('..'+sep)&&!isAbsolute(rel);
}
export async function scope(context){
 const input=context?.input;
 if(!input||typeof input!=='object'||Array.isArray(input)||typeof context.runCommand!=='function')
   throw Error('shortcut requires structured input and host command runner');
 const project=await realpath(resolve(input.projectPath||new URL('../',import.meta.url).pathname));
 if(basename(project)!=='vlog')throw Error('vlog project root required');
 const text=typeof input.taskInput==='string'?input.taskInput:'';
 const path=input.runPath??text.match(/^- Canonical run:\s*(\/[^\r\n]+)$/m)?.[1];
 if(typeof path!=='string'||!isAbsolute(path))throw Error('absolute runPath required');
 const run=await realpath(path),runs=await realpath(join(project,'runs'));
 if(!inside(runs,run)||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}(?:-[a-zA-Z0-9-]+)?$/.test(relative(runs,run)))
   throw Error('run outside canonical vlog dated run directory');
 return {input,project,run};
}
export async function file(run,name){
 if(typeof name!=='string'||!name||isAbsolute(name)||name.split(/[\/]/).includes('..'))
   throw Error('unsafe run artifact path');
 const expected=resolve(run,name),actual=await realpath(expected);
 if(!inside(run,actual)||!(await stat(actual)).isFile()||(await stat(actual)).size<1)
   throw Error('missing or untrusted run artifact '+name);
 return actual;
}
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function digest(path){return sha256(await readFile(path));}
export async function command(context,args,cwd){
 const result=await context.runCommand(args,cwd);
 if(result?.code!==0)throw Error('command failed '+args.slice(0,3).join(' ')+': '+String(result?.stderr||result?.stdout||result?.code));
 return result;
}
export function parseResult(output){
 const str=String(output||'').trim();
 try{
   const parsed=JSON.parse(str);
   // WebHelm CLI wraps the Action receipt in a platform-run envelope.
   if(parsed?.result && typeof parsed.result==='object'){
     if(parsed.result.ok!==true)throw Error('platform action did not succeed: '+String(parsed.result.error||'unknown'));
     if(parsed.result.value && typeof parsed.result.value==='object')return parsed.result.value;
     return parseResult(parsed.result.stdout);
   }
   return parsed;
 }catch(error){if(error.message?.startsWith('platform action did not succeed'))throw error;}
 for(const line of str.split(/\r?\n/).reverse()){
   const match=line.match(/(?:XHS_RECEIPT\s+)?(\{.*\})\s*$/);
   if(match){try{return JSON.parse(match[1])}catch{}}
 }
 throw Error('platform action provided no machine-readable receipt');
}
