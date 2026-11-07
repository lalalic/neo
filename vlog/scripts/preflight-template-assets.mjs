#!/usr/bin/env node
/** Resolve only assets explicitly declared by the selected Vlog template. */
import {readFileSync,realpathSync,statSync} from 'node:fs';
import {resolve,dirname,isAbsolute,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const template=readFileSync(resolve(root,'templates/cinematic-vlog.md'),'utf8');
const match=template.match(/<!-- VLOG:CONFIG\s*([\s\S]*?)\s*VLOG:END_CONFIG -->/);
if(!match)throw Error('TEMPLATE_CONFIG_MISSING');
const cfg=JSON.parse(match[1]);
const errors=[],resolved={};
function within(p){const rel=relative(root,p);return rel===''||(!rel.startsWith('..'+sep)&&rel!=='..'&&!isAbsolute(rel));}
function inspect(value,label){
 if(typeof value!=='string'||!value.trim()){errors.push(label+': missing');return;}
 if(label.endsWith('_url')){
  try{const u=new URL(value);if(u.protocol!=='https:'||!u.hostname||u.username||u.password)throw Error('invalid https URL');resolved[label]=u.href;}catch{errors.push(label+': invalid HTTPS URL');}
 }else{
  try{const full=realpathSync(resolve(root,value));if(!within(full)||!statSync(full).isFile()||statSync(full).size<=0)throw Error('missing or outside project');resolved[label]=full;}catch{errors.push(label+': unreadable template asset '+value);}
 }
}
for(const [key,value] of Object.entries(cfg.song??{}))if(key.endsWith('_url')||key.endsWith('_file'))inspect(value,'song.'+key);
// Additional template-local assets can be declared in config.assets as [{path,url}].
for(const [i,item] of (cfg.assets??[]).entries()){
 if(item?.path) inspect(item.path,'assets.'+i+'.file');
 if(item?.url) inspect(item.url,'assets.'+i+'_url');
}
const report={stage:'template-assets',status:errors.length?'FAIL':'PASS',resolved,errors};
console.log(JSON.stringify(report,null,2));
if(errors.length)process.exitCode=1;
