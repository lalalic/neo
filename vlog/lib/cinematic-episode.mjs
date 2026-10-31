/** Assemble a source-bound Cinematic Natural episode and a required Route subvideo. */
import {readFile,writeFile,mkdir,copyFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {resolve,relative,join,dirname,basename,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readGpsMetadata} from './gps-route.mjs';
import {planGeoStory,geoStoryMarkdown} from './geo-story.mjs';
import {compileCinematicVlog,lintCinematicVlog} from './cinematic-vlog.mjs';
const run=promisify(execFile);
const safeName=s=>/^[\w.\-/]+$/.test(s)&&!s.split('/').includes('..');
const sha=buf=>createHash('sha256').update(buf).digest('hex');
const ffprobe=async(path)=>{
 const {stdout}=await run('ffprobe',['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',path]);
 const n=Number(stdout.trim());if(!Number.isFinite(n)||n<=0)throw Error('invalid media duration: '+path);return n;
};
const audioCodec=async(path)=>{
 const {stdout}=await run('ffprobe',['-v','error','-select_streams','a','-show_entries','stream=codec_name','-of','default=noprint_wrappers=1:nokey=1',path]);
 if(!stdout.trim())throw Error('NO_AUDIO_TRACK: '+path);
};
export function insertGeoRoute(input,route){
 if(!route?.required)return input;
 if(!input?.scenes?.length||!Array.isArray(input.boundaries))throw Error('Bad episode scene inputs');
 const scenes=structuredClone(input.scenes), boundaries=structuredClone(input.boundaries);
 if(scenes.some(x=>x.id==='gps-geography'))throw Error('Route already inserted');
 if(boundaries.length!==scenes.length-1)throw Error('Missing Editor boundary decisions');
 const original=boundaries[0];
 const bridge={...original,rationale:`Geographical context from verified photo EXIF: ${route.evidenceRef}`};
 scenes.splice(1,0,{id:'gps-geography',type:'video',path:route.path,sourceHash:route.sha256,
  authorized:true,evidenceRef:route.evidenceRef,beat:'geographical-context',duration:route.duration,volume:1,
  audioIntent:'narration',intent:'Show real photographed stops and narrate sourced place and content evidence, never claim a tracked path'});
 boundaries.splice(0,1,bridge,{...original,rationale:`Return from GPS explanation to Editor's source story. ${original.rationale}`});
 return {...input,scenes,boundaries};
}
export async function buildCinematicEpisode(input,{runDir=process.cwd(),markcutRoot,renderRoute=true}={}){
 const root=resolve(runDir);
 await mkdir(root,{recursive:true});
 // Scan episode originals by default. GPS cannot be silently ignored because
 // the Director omitted a separate geo.media list.
 const sourceFiles=input.geo?.media?.length ? input.geo.media : (input.scenes||[]).map(s=>s.sourceEvidencePath||s.path);
 if(sourceFiles.some(f=>!safeName(f)))throw Error('Invalid GPS media file reference');
 const metadata=await readGpsMetadata(sourceFiles.map(p=>resolve(root,p)));
 const evidence={...(input.geo||{}),mediaEvidence:(input.geo?.mediaEvidence||[]).map(m=>({...m,source:resolve(root,m.source)})),
  locationEvidence:(input.geo?.locationEvidence||[]).map(m=>({...m,source:resolve(root,m.source)}))};
 const story=planGeoStory(metadata,evidence);
 let route=null;
 if(story.required){
  if(!renderRoute)throw Error('GPS_ROUTE_REQUIRED: cannot omit subvideo without performing verified rendering');
  if(!markcutRoot)throw Error('MARKCUT_ROOT_REQUIRED: route rendering requires Markcut');
  const assetsDir=join(root,'assets','geo-story');await mkdir(assetsDir,{recursive:true});
  const files=[];
  for(let i=0;i<story.scenes.length;i++){
   const name=`voice-${i+1}.mp3`,abs=join(assetsDir,name);
   const voice=input.voice?.id||'zh-CN-YunxiNeural';
   const token=sha(Buffer.from(voice+'\0'+story.scenes[i].text));
   const metaFile=abs+'.evidence.json';
   let reused=false;
   try{const m=JSON.parse(await readFile(metaFile,'utf8')); reused=m.textHash===token&&m.audioHash===sha(await readFile(abs));}catch{}
   if(!reused){
    await run('uvx',['edge-tts','--voice',voice,'--text',story.scenes[i].text,'--write-media',abs],{maxBuffer:1024*1024});
    await writeFile(metaFile,JSON.stringify({textHash:token,audioHash:sha(await readFile(abs)),voice}));
   }
   await audioCodec(abs);
   const duration=await ffprobe(abs);
   story.scenes[i].duration=Math.max(story.scenes[i].duration,Math.ceil(duration+0.6));
   story.scenes[i].map=story.scenes[i].map.replace(/\bduration:\d+(?:\.\d+)?/,`duration:${story.scenes[i].duration}`);
   files.push({path:`assets/geo-story/${name}`,duration:Number(duration.toFixed(3))});
  }
  const routeMd=join(root,'route.md');await writeFile(routeMd,geoStoryMarkdown(story,{width:input.geo.width||720,height:input.geo.height||1280,audioFiles:files}));
  const previewModule=resolve(markcutRoot,'src/mcp/preview.mjs');
  const {ensureVideoPreview}=await import(pathToFileURL(previewModule).href);
  const preview=await ensureVideoPreview(routeMd);
  const compiled=JSON.parse(await readFile(join(root,'.markcut','route','default','compiled.json'),'utf8'));
  const comp=compiled.root||compiled;
  if(comp.children.length!==story.scenes.length||comp.children.some(s=>!s.children?.some(x=>x.type==='video'&&x.src?.startsWith('https://'))||!s.children?.some(x=>x.type==='audio'&&x.src))){
   throw Error('GPS_ROUTE_PREVIEW_INCOMPLETE: map video or narration missing');
  }
  const props=join(assetsDir,'route-render-props.json');await writeFile(props,JSON.stringify({root:comp}));
  const renderPath=join(root,'assets','route.mp4');
  await run(resolve(markcutRoot,'node_modules/.bin/remotion'),['render',resolve(markcutRoot,'src/index.ts'),'Root',renderPath,'--props',props,'--codec','h264','--concurrency','1'],{cwd:resolve(markcutRoot),maxBuffer:8*1024*1024,timeout:240000});
  await audioCodec(renderPath);
  const stats=await stat(renderPath);if(stats.size<10000)throw Error('Route render too small');
  const duration=await ffprobe(renderPath), routeHash=sha(await readFile(renderPath));
  route={required:true,path:'assets/route.mp4',duration:Number(duration.toFixed(3)),sha256:routeHash,
   evidenceRef:'geo-story/evidence.json',previewHash:preview.contentHash,output:renderPath};
  const publication={kind:story.kind,observedPoints:story.points,mediaEvidenceRefs:story.mediaEvidenceUsed,
   locationEvidenceRefs:story.locationEvidenceUsed,scenes:story.scenes.map(s=>({id:s.id,view:s.view,narration:s.text,duration:s.duration})),
   previewHash:preview.contentHash,renderSha256:routeHash};
  await writeFile(join(assetsDir,'evidence.json'),JSON.stringify(publication,null,2));
 }
 const expanded=insertGeoRoute(input,route);
 const originalCwd=process.cwd();
 try{
  process.chdir(root);
  const markdown=compileCinematicVlog(expanded);
  const issues=lintCinematicVlog(markdown,expanded);
  if(issues.length)throw Error(issues.join('\n'));
  if(route && !markdown.includes('src:assets/route.mp4'))throw Error('REQUIRED_GPS_ROUTE_MISSING');
  const main=resolve(root,'video.md');await writeFile(main,markdown);
  await writeFile(resolve(root,'episode-production.json'),JSON.stringify({route,sourceSceneCount:input.scenes.length,finalSceneCount:expanded.scenes.length,status:'draft-needs-review'},null,2));
  return {video:main,route,story,finalSceneCount:expanded.scenes.length};
 } finally {process.chdir(originalCwd);}
}
