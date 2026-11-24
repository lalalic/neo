#!/usr/bin/env node
/**
 * Live Neo Harness Node↔Rust read-only CLI parity acceptance.
 * Never prints bootstrap rules, private paths, credential data, service logs
 * or raw tool responses. It neither creates tasks nor performs UI actions.
 * Requires the source checkout and compiled Rust preview binary.
 */
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const rust=join(root,'target/debug/neo-rs');
const node=join(root,'.bin/neo.mjs');
if(!existsSync(rust)||!existsSync(node)){
  console.error('Rust native preview binary or reference Node CLI is unavailable; build and retry.');
  process.exit(2);
}
function run(native,args){
  const command=native?rust:process.execPath;
  const result=spawnSync(command,native?args:[node,...args],{
    cwd:root,encoding:'utf8',timeout:15000,maxBuffer:12*1024*1024});
  return {code:result.status,stdout:result.stdout||'',error:result.error?.code||null};
}
function sort(value){
  if(Array.isArray(value))return value.map(sort);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,sort(value[key])]));
  return value;
}
function parse(value,kind){
  if(kind==='text')return value;
  const parsed=JSON.parse(value);
  if(kind==='computer-help'){
    for(const item of parsed.content||[])if(item.type==='text')try{item.text=JSON.parse(item.text);}catch{}
  }
  if(kind==='service-inventory'&&Array.isArray(parsed)){
    for(const item of parsed){delete item.pid;delete item.state;}
  }
  return sort(parsed);
}
const cases=[
  {name:'workspace show',args:['workspace','show']},
  {name:'project list',args:['project','list']},
  {name:'skill list',args:['skill','list']},
  {name:'agent global discovery',args:['agent','list']},
  {name:'agent shared discovery',args:['agent','list','--source','shared']},
  {name:'agent semantic search',args:['agent','search','rust','--limit','5']},
  {name:'bootstrap JSON',args:['bootstrap','--json']},
  {name:'native NeoY MCP inventory',args:['mcp','tools']},
  {name:'native Computer Use help',args:['computer-use','help'],kind:'computer-help'},
  {name:'PM2/launchd inventory',args:['service','list'],kind:'service-inventory'},
  {name:'status',args:['status']},
  {name:'doctor',args:['doctor']},
  {name:'Project Run reference help',args:['project','run','--help'],kind:'text'},
  {name:'Escalation reference help',args:['escalation','--help'],kind:'text'},
];
const results=[];
for(const test of cases){
  const a=run(false,test.args),b=run(true,test.args);
  let same=false,source_count=null;
  if(!a.error&&!b.error&&a.code===0&&b.code===0){
    try{
      const nodeValue=parse(a.stdout,test.kind);
      const rustValue=parse(b.stdout,test.kind);
      same=JSON.stringify(nodeValue)===JSON.stringify(rustValue);
      if(Array.isArray(nodeValue))source_count=nodeValue.length;
      else if(Array.isArray(nodeValue?.skills))source_count=nodeValue.skills.length;
      else if(Array.isArray(nodeValue?.tools))source_count=nodeValue.tools.length;
    }catch{same=false;}
  }
  results.push({name:test.name,pass:same,nodeExit:a.code,rustExit:b.code,...(source_count===null?{}:{count:source_count})});
}
const outcome={schemaVersion:1,scope:'read-only-live-native-vs-node',
  passes:results.filter(t=>t.pass).length,total:results.length,results};
console.log(JSON.stringify(outcome,null,2));
if(outcome.passes!==outcome.total)process.exitCode=1;
