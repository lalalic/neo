import { lstat, readFile, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Only secure path resolution and invocation plumbing live here.
// Domain validation belongs to the existing project CLI and schema contracts.
const here=dirname(fileURLToPath(import.meta.url));
const defaultProject=resolve(here,'../..');

export function inside(root,target) {
  const rel=relative(root,target);
  return rel!==''&&rel!=='..'&&!rel.startsWith(`..${sep}`)&&!isAbsolute(rel);
}

export async function scope(context) {
  const input=context?.input;
  if(!input||typeof input!=='object'||Array.isArray(input)) throw Error('shortcut_structured_input_required');
  const project=await realpath(resolve(input.projectPath||defaultProject));
  if(basename(project)!=='content-distribution') throw Error('wrong_content_distribution_project');
  const text=typeof input.taskInput==='string'?input.taskInput:'';
  const declared=input.runPath??text.match(/^- Canonical run:\s*(\/[^\r\n]+)$/m)?.[1];
  if(typeof declared!=='string'||!isAbsolute(declared)) throw Error('canonical_run_path_required');
  const runs=await realpath(join(project,'runs'));
  const run=await realpath(declared);
  if(!inside(runs,run)) throw Error('run_outside_private_project');
  const rel=relative(runs,run).split(sep);
  if(rel.length>2||!/^\d{4}-\d{2}-\d{2}(?:-[a-zA-Z0-9-]+)?$/.test(rel.at(-1))||
    (rel.length===2&&!/^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(rel[0])))
    throw Error('run_not_canonically_dated');
  if(typeof context.runCommand!=='function') throw Error('relay_owned_command_runner_required');
  return {project,run,input};
}

export async function readRun(run,name) {
  if(typeof name!=='string'||!name||isAbsolute(name)||name.split(/[\\/]/).includes('..')) throw Error('unsafe_run_relative_path');
  const file=resolve(run,name);
  const actual=await realpath(file);
  if(!inside(run,actual)||!(await lstat(file)).isFile()) throw Error('run_evidence_outside_scope_or_not_file');
  return {path:actual,text:await readFile(actual,'utf8')};
}

export async function jsonRun(run,name) {
  const file=await readRun(run,name);
  return {...file,data:JSON.parse(file.text)};
}

export async function command(context,project,args,{json=false}={}) {
  if(!Array.isArray(args)||!args.length||args.some(value=>typeof value!=='string')) throw Error('invalid_shortcut_argv');
  const result=await context.runCommand(args,project);
  if(result?.code!==0) throw Error('shortcut_existing_cli_check_failed');
  if(!json) return result;
  try { return JSON.parse(String(result.stdout)); }
  catch { throw Error('shortcut_cli_response_not_json'); }
}

export function completed(output,artifacts) {
  return {status:'COMPLETED',output,artifacts};
}
export const sourceCheck=(context,project,run)=>command(context,project,
  [process.execPath,join(project,'scripts/check-original-source.mjs'),'--run',run],{json:true});
export const runSchema=(context,project,file,schema)=>command(context,project,
  ['npx','agents-relay','artifact','validate','--artifact',file,'--schema',join(project,'contracts',schema)],{json:true});
