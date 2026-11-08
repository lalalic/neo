/** Project-local Markcut Review presentation helpers, not Agent output contracts. */
import {readFile, writeFile, mkdir, realpath, stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,resolve,relative,isAbsolute,basename} from 'node:path';
import {spawn} from 'node:child_process';

export const reviewRoot = run => join(run,'assets','review');
export const json = async path => JSON.parse(await readFile(path,'utf8'));
export const clamp = (s,n=250) => String(s??'').replace(/[\u0000-\u001f]+/g,' ').trim().slice(0,n);
export const quote = value => JSON.stringify(String(value).replace(/[\u0000-\u001f]+/g,' ').trim());
export const jsxText = s => JSON.stringify(clamp(s,360)).replace(/</g,'\\u003c').replace(/>/g,'\\u003e');
export const within = (root,target) => {const rel=relative(root,target);return rel===''||(!rel.startsWith('..')&&!isAbsolute(rel));};
export async function runDir(value){
 if(!value || !isAbsolute(value))throw Error('An absolute canonical Run path is required');
 const run=await realpath(resolve(value));
 if(!/^[0-9]{4}-[0-9]{2}-[0-9]{2}(?:-[A-Za-z0-9-]+)?$/.test(basename(run)))throw Error('Must be a dated Vlog Run');
 const runs=await realpath(new URL('../runs/',import.meta.url).pathname);
 if(!within(runs,run)||run===runs)throw Error('Run outside Vlog runs/');
 return run;
}
export async function sourceIndex(run){
 const m=await json(join(run,'source-manifest.json'));
 if(!Array.isArray(m.media)||m.media.length===0)throw Error('Source manifest lacks media');
 const directory=await realpath(join(run,'input','media'));
 const byId=new Map();
 for(const src of m.media){
  if(!/^[A-Za-z0-9_-]{1,64}$/.test(src.id??'')||byId.has(src.id))throw Error('Invalid/duplicate source ID');
  if(src.use_approved!==true||!/^[a-f0-9]{64}$/i.test(src.sha256??''))throw Error('Source not approved/verified: '+src.id);
  if(typeof src.path!=='string'||src.path.startsWith('.')||src.path.split('/').some(x=>x==='..'||!x))throw Error('Unsafe source path');
  const path=await realpath(join(directory,src.path));
  if(!within(directory,path)||!(await stat(path)).isFile())throw Error('Source escape/nonfile: '+src.id);
  const type=src.media_type;
  if(!['video','image'].includes(type))throw Error('Unsupported source type: '+type);
  byId.set(src.id,{...src,absolute:path});
 }
 return byId;
}
export function command(exe,args){return new Promise((resolve,reject)=>{
 const proc=spawn(exe,args,{stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
 proc.stdout.on('data',x=>{stdout+=x.toString().slice(0,20000);});
 proc.stderr.on('data',x=>{stderr+=x.toString().slice(-20000);});
 proc.on('error',reject);proc.on('close',code=>code===0?resolve(stdout):reject(Error(exe+' failed ('+code+'): '+stderr.slice(-1200))));
});}
export const hashFile=async(path)=>{const {createReadStream}=await import('node:fs');return new Promise((res,rej)=>{const h=createHash('sha256'),stream=createReadStream(path);stream.on('data',b=>h.update(b));stream.on('error',rej);stream.on('end',()=>res(h.digest('hex')));});};
export function guideCard({title,guide,recommended=false,duration=3}){
 const heading=recommended?'★ Director 推荐 · '+title:title;
 const h=jsxText(heading),g=jsxText(guide);
 return ['- component duration:'+duration,'  ~~~jsx',
  '  <div style={{width:"100%",height:"100%",boxSizing:"border-box",display:"flex",flexDirection:"column",justifyContent:"center",padding:48,background:"#101827",color:"#fff",fontFamily:"system-ui,sans-serif"}}>',
  '    <div style={{fontSize:46,fontWeight:750,lineHeight:1.25,marginBottom:24}}>{'+h+'}</div>',
  '    <div style={{fontSize:30,lineHeight:1.45,color:"#dbe7f5",whiteSpace:"pre-wrap"}}>{'+g+'}</div>',
  '  </div>','  ~~~'].join('\n');
}
export async function previewAsset(run,src,{stage,key,start=0,end=null,stillSeconds=3}){
 const directory=join(reviewRoot(run),stage);await mkdir(directory,{recursive:true});
 if(!/^[a-z0-9_-]{1,90}$/.test(key))throw Error('Unsafe review asset key');
 const kind=src.media_type;
 const relativePath=`assets/review/${stage}/${key}.${kind==='image'?'jpg':'mp4'}`;
 const output=join(run,relativePath);
 const digest=await hashFile(src.absolute);
 if(digest.toLowerCase()!==src.sha256.toLowerCase())throw Error('Original source hash changed: '+src.id);
 if(kind==='image'){
  await command('ffmpeg',['-y','-v','error','-i',src.absolute,'-frames:v','1','-vf','scale=540:960:force_original_aspect_ratio=decrease','-q:v','5',output]);
  return {path:relativePath,duration:stillSeconds,type:'image'};
 }
 const bounds=src.usable_time_range_seconds;
 if(!Array.isArray(bounds)||bounds.length!==2||!bounds.every(Number.isFinite))throw Error('Missing real source time range: '+src.id);
 const from=start??bounds[0],to=end??Math.min(bounds[1],from+18);
 if(!Number.isFinite(from)||!Number.isFinite(to)||from<bounds[0]||to>bounds[1]+.02||to-from<.25||to-from>30)throw Error('Invalid source-time interval: '+src.id);
 const length=Number((to-from).toFixed(3));
 // Exact, continuous source-time interval; never use time-sampled Vision proxies.
 await command('ffmpeg',['-y','-v','error','-ss',String(from),'-i',src.absolute,'-t',String(length),
  '-vf','scale=360:640:force_original_aspect_ratio=decrease,setsar=1','-r','24','-c:v','libx264','-preset','ultrafast','-crf','29','-pix_fmt','yuv420p','-map','0:v:0','-map','0:a:0?','-c:a','aac','-b:a','64k','-movflags','+faststart','-map_metadata','-1',output]);
 return {path:relativePath,duration:length,type:'video',from,to};
}
export function mediaNode(asset){
 return asset.type==='image'?`- image src:${asset.path} duration:${asset.duration} fit:contain`:
   `- video src:${asset.path} duration:${asset.duration} volume:1 fit:contain`;
}
export async function saveMd(path,scenes,{title,metadata}){
 const lines=['# video',`title:${quote(title)} width:720 height:1280 fps:24 layout:series stt:false metadata:${quote(metadata)}`,''];
 for(const scene of scenes){
  if(!/^[a-z][a-z0-9-]{0,60}$/.test(scene.id))throw Error('Unsafe scene name: '+scene.id);
  lines.push('## '+scene.id,`title:${quote(scene.title)} layout:series instruction:${quote(scene.instruction)}`);
  lines.push(guideCard(scene));for(const media of scene.media)lines.push(mediaNode(media));lines.push('');
 }
 // Resolve Markcut seed *before* the immutable Relay Stage checkpoint.
 // Rendering/preview must never silently add an uncommitted seed line.
 const seeded=createHash('sha256').update(lines.join('\n')).digest().readUInt32BE(0);
 lines.splice(1,0,'seed:'+seeded);
 await writeFile(path,lines.join('\n')+'\n');
 await command('markcut',['verify',path]);
 return path;
}
