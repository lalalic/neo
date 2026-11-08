#!/usr/bin/env node
/** Private Vlog history: index only; full story and media remain in each Run. */
import {existsSync,readFileSync,writeFileSync,renameSync,mkdirSync,realpathSync,readdirSync,statSync,rmSync,lstatSync,chmodSync} from 'node:fs';
import {resolve,dirname,relative,isAbsolute,sep,basename,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
const project=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const runsDir=resolve(project,'runs');
const library=join(runsDir,'.story-history');
const indexPath=join(library,'history-index.json');
const profilePath=join(project,'user.md');
const blank=()=>({schemaVersion:1,entries:[]});
const inside=(parent,path)=>{const r=relative(parent,path);return !!r&&r!=='..'&&!r.startsWith('..'+sep)&&!isAbsolute(r);};
const shorten=(s,n=110)=>typeof s==='string'?s.trim().replace(/\s+/g,' ').slice(0,n):'';
function readJson(path){try{return JSON.parse(readFileSync(path,'utf8'));}catch{return null;}}
function safeFile(run,name){try{const p=realpathSync(join(run,name));return inside(run,p)&&statSync(p).isFile()&&statSync(p).size>0;}catch{return false;}}
export function canonicalRun(path){
 const p=realpathSync(resolve(path)),root=realpathSync(runsDir);
 const rel=relative(root,p);
 if(!inside(root,p)||!statSync(p).isDirectory()||!rel.split(sep).some(x=>/^\d{4}-\d{2}-\d{2}(?:$|[-_])/.test(x)))throw Error('HISTORY_INVALID_RUN');
 return p;
}
function hasRenderedVideo(run){
 try{return readdirSync(join(run,'output'),{withFileTypes:true}).some(entry=>
  entry.isFile()&&/\.(mp4|mov|m4v)$/i.test(entry.name)&&safeFile(run,'output/'+entry.name));}
 catch{return false;}
}
function heading(path){try{return shorten(readFileSync(path,'utf8').split('\n').find(x=>/^#\s+/.test(x))?.replace(/^#\s+/,''),85);}catch{return '';}}
export function entryFor(path){
 const run=canonicalRun(path);
 const personal=safeFile(run,'personal-story.md')&&safeFile(run,'personal-story.json');
 const story=personal?readJson(join(run,'personal-story.json')):null;
 if(!story&&!safeFile(run,'story.md'))return null;
 const complete=!!story&&story.perspective==='first_person';
 const rendered=hasRenderedVideo(run)&&safeFile(run,'video.md');
 const archived=rendered&&safeFile(run,'qa.md')&&safeFile(run,'archive-receipt.json');
 const names=['personal-story.md','personal-story.json','story.md','shot-selection.json','edit-decision-list.json','video.md','qa.md','archive-receipt.json'];
 const rel=relative(runsDir,run).split(sep).join('/');
 const tags=[...(Array.isArray(story?.tags)?story.tags:[]),story?.tone,story?.arc?.everyday_goal,story?.arc?.setback];
 return {runId:rel,runPath:'runs/'+rel,date:rel.match(/\d{4}-\d{2}-\d{2}/)?.[0]??'',
  type:complete?'personal-story':'legacy-unverified',status:archived?'archived':rendered?'rendered':complete?'story-ready':'legacy',
  title:shorten(story?.title,85)||heading(join(run,'story.md'))||basename(run),
  storyId:complete?shorten(story.story_id,90):null,
  premise:complete?shorten([story.arc?.everyday_goal,story.arc?.setback].filter(Boolean).join(' → '),140):'',
  tags:[...new Set(tags.map(x=>shorten(x,40)).filter(Boolean))].slice(0,12),
  artifacts:names.filter(x=>safeFile(run,x))};
}
function load(){
 if(!existsSync(indexPath))return blank();
 const x=readJson(indexPath);
 if(x?.schemaVersion!==1||!Array.isArray(x.entries))throw Error('HISTORY_INDEX_INVALID: rebuild explicitly to repair');
 return x;
}
function privateLibrary(){
 mkdirSync(library,{recursive:true,mode:0o700});
 if(!lstatSync(library).isDirectory()||lstatSync(library).isSymbolicLink())throw Error('HISTORY_INVALID_LIBRARY');
 if((lstatSync(library).mode&0o077)!==0)throw Error('HISTORY_LIBRARY_NOT_PRIVATE');
}
function store(data){
 privateLibrary();
 const temp=join(library,'.history-'+randomUUID()+'.tmp');
 try{writeFileSync(temp,JSON.stringify(data,null,2)+'\n',{mode:0o600});renameSync(temp,indexPath);}
 finally{rmSync(temp,{force:true});}
}
function withLock(fn){
 privateLibrary();
 const lock=join(library,'.history.lock');let locked=false;
 for(let n=0;n<40;n++){
  try{mkdirSync(lock);locked=true;break;}
  catch(e){if(e.code!=='EEXIST')throw e;if(n===39)throw Error('HISTORY_INDEX_LOCK_BUSY');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,100);}
 }
 try{return fn();}
 finally{if(locked)rmSync(lock,{recursive:true,force:true});}
}
const recent=entries=>entries.sort((a,b)=>b.date.localeCompare(a.date)||a.runId.localeCompare(b.runId));
export function record(path){
 const entry=entryFor(path);if(!entry)return null;
 return withLock(()=>{const data=load();data.entries=recent([...data.entries.filter(e=>e.runId!==entry.runId),entry]);store(data);return entry;});
}
function discover(dir,depth=0){
 if(depth>4||!existsSync(dir))return [];
 const paths=[];
 for(const item of readdirSync(dir,{withFileTypes:true})){
  if(!item.isDirectory()||item.name.startsWith('.')||['input','assets','output','reviews','execution','.service','.markcut','logs','generated'].includes(item.name))continue;
  const p=join(dir,item.name);
  if(safeFile(p,'personal-story.json')||safeFile(p,'story.md'))paths.push(p);
  else paths.push(...discover(p,depth+1));
 }
 return paths;
}
export function rebuild(){return withLock(()=>{
 const entries=discover(runsDir).map(p=>{try{return entryFor(p);}catch{return null;}}).filter(Boolean);
 store({schemaVersion:1,entries:recent(entries)});return {indexed:entries.length,index:indexPath};
});}
export function search(term='',limit=20){
 const q=shorten(term,100).toLowerCase();
 return load().entries.filter(e=>!q||[e.title,e.premise,...e.tags].join(' ').toLowerCase().includes(q)).slice(0,Math.min(100,Math.max(1,Number(limit)||20)));
}
export function inspect(id){
 const item=load().entries.find(x=>x.runId===id);if(!item)throw Error('HISTORY_RUN_NOT_INDEXED');
 const run=canonicalRun(join(runsDir,item.runId));
 return {...item,paths:Object.fromEntries(item.artifacts.filter(name=>safeFile(run,name)).map(name=>[name,join(run,name)]))};
}
export function command(args){
 const [cmd,...rest]=args;
 if(cmd==='init'){privateLibrary();if(!existsSync(indexPath))store(blank());return {index:indexPath,user:profilePath,profileExists:existsSync(profilePath)};}
 if(cmd==='record'){if(rest[0]!=='--run'||!rest[1])throw Error('record --run ABSOLUTE_PATH');return record(rest[1]);}
 if(cmd==='rebuild')return rebuild();
 if(cmd==='search'){const pos=rest.indexOf('--limit');return search(rest.slice(0,pos===-1?undefined:pos).join(' '),pos===-1?20:rest[pos+1]);}
 if(cmd==='inspect'){if(!rest[0])throw Error('inspect RUN_ID');return inspect(rest[0]);}
 throw Error('Usage: story-history.mjs init | record --run ABSOLUTE_PATH | rebuild | search [terms] [--limit N] | inspect RUN_ID');
}
if(process.argv[1]&&realpathSync(resolve(process.argv[1]))===realpathSync(fileURLToPath(import.meta.url))){
 try{console.log(JSON.stringify(command(process.argv.slice(2)),null,2));}
 catch(e){console.error(e.message);process.exitCode=1;}
}
