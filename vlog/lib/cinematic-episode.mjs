/** Assemble a source-bound Cinematic Natural episode and a required Route subvideo. */
import {readFile,writeFile,mkdir,copyFile,stat,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {resolve,relative,join,dirname,basename,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readGpsMetadata} from './gps-route.mjs';
import {planGeoStory,geoStoryMarkdown} from './geo-story.mjs';
import {compileCinematicVlog,lintCinematicVlog} from './cinematic-vlog.mjs';
import {assertAudiovisualStory} from './story-plan.mjs';
import {preparePlaybackMedia} from './media-treatment.mjs';
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
/** Include both selected source media and supplemental geotagged media. */
export function gpsSourceFiles(input){
 return [...new Set([...(input.scenes||[]).map(s=>s.sourceEvidencePath||s.path),...(input.geo?.media||[])].filter(Boolean))];
}

export function insertGeoRoute(input,route){
 if(!route?.required)return input;
 if(!input?.scenes?.length||!Array.isArray(input.boundaries))throw Error('Bad episode scene inputs');
 const scenes=structuredClone(input.scenes), boundaries=structuredClone(input.boundaries);
 if(scenes.some(x=>x.id==='gps-geography'))throw Error('Route already inserted');
 if(boundaries.length!==scenes.length-1)throw Error('Missing Editor boundary decisions');
 // Place the route at the Director's narrative turn, before the payoff.
 const afterId=input.geo?.insertAfterSceneId;
 const at=afterId?scenes.findIndex(x=>x.id===afterId):0;
 if(at<0||at>=scenes.length-1)throw Error('Invalid geographic story insertion point: choose a scene before payoff');
 const original=boundaries[at];
 const bridge={...original,rationale:`GPS context advances the story after ${scenes[at].id}; evidence: ${route.evidenceRef}. ${original.rationale}`};
 scenes.splice(at+1,0,{id:'gps-geography',type:'video',path:route.path,sourceHash:route.sha256,
  authorized:true,evidenceRef:route.evidenceRef,beat:'geographical-context',duration:route.duration,volume:1,
  audioIntent:'narration',intent:input.geo?.storyIntent||'Real filmed stops and sourced local knowledge; road navigation is not a recorded track'});
 boundaries.splice(at,1,bridge,{...original,rationale:`Continue the story from the map to ${scenes[at+2].id}. ${original.rationale}`});
 return {...input,scenes,boundaries};
}
/** An offline position schematic is not navigation: verify the Director's
 * selected media samples against the original private manifest instead of
 * requiring a continuous GPS track or any Maps/Routes API. */
export async function verifiedOfflineGeoStory(root,geo){
 if(!Array.isArray(geo?.points)||geo.points.length<2||geo.points.length>24)
  throw Error('OFFLINE_GPS_POINTS: Director-approved original locations required');
 const manifest=JSON.parse(await readFile(resolve(root,'source-manifest.json'),'utf8'));
 const intent=JSON.parse(await readFile(resolve(root,'route-intent.json'),'utf8'));
 if(manifest?.source_use?.approved!==true||
   !/private/i.test(String(manifest?.source_use?.scope??''))||intent?.decision!=='include')
  throw Error('OFFLINE_GPS_RIGHTS: missing private authorization or Director intent');
 const selected=intent.observedStops;
 if(!Array.isArray(selected)||selected.length!==geo.points.length)
  throw Error('OFFLINE_GPS_SELECTED: GPS stops differ from Director selection');
 const byId=new Map((manifest.media??[]).map(x=>[x.id,x]));
 const used=new Set();
 const points=geo.points.map((point,i)=>{
  const id=point.sourceId,source=byId.get(id);
  if(typeof id!=='string'||id!==selected[i]?.sourceId||used.has(id)||!selected[i]?.evidenceRef||
    !source?.use_approved||source.identity_verified!=='sha256_exact'||
    !/^[a-f0-9]{64}$/.test(source.sha256??''))
   throw Error('OFFLINE_GPS_SOURCE: unapproved, repeated or out-of-order source ID');
  used.add(id);
  const lat=Number(source.original_location?.latitude),lng=Number(source.original_location?.longitude);
  if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180||
    Math.abs(lat-Number(point.lat))>0.0000005||Math.abs(lng-Number(point.lng))>0.0000005)
   throw Error('OFFLINE_GPS_COORDINATES: source coordinate mismatch');
  return {sourceId:id,source:'input/media/'+source.path,lat,lng};
 });
 return {required:true,reason:'director-selected-original-gps-positions',kind:'offline-source-gps-schematic',
    points,scenes:[],trackedMovement:false,travelMode:null};
}

/** Bind an offline GPS schematic only when its bytes, duration and selected
 * source positions match the verified route evidence, with no network access. */
export async function verifiedOfflineGeoRoute(root,geo,story){
  const mediaRel=geo.offlineRoutePath;
  const evidenceRel=geo.offlineEvidencePath;
  if(mediaRel!=='assets/route.mp4'||evidenceRel!=='assets/geo-story/evidence.json')
   throw Error('OFFLINE_ROUTE_PATH: canonical local route and evidence paths required');
  const media=await realpath(resolve(root,mediaRel)),proof=await realpath(resolve(root,evidenceRel));
  if(!media.startsWith(root+'/assets/')||!proof.startsWith(root+'/assets/geo-story/'))
   throw Error('OFFLINE_ROUTE_ESCAPE: route references must remain inside the Run');
  const evidence=JSON.parse(await readFile(proof,'utf8'));
  // Two explicit offline evidence schemes exist: canonical helper and
  // Editor-authored per-source verification. Both must match the actual
  // media SHA-256, duration and the precise selected GPS positions.
  const automatic=evidence.kind==='offline-gps-position-schematic'&&evidence.status==='VERIFIED'&&
     evidence.declaredNoTravelTrack===true;
  const authored=evidence.method==='coordinate-proportional schematic rendered from original GPS coordinates'&&
     typeof evidence.lineSemantics==='string'&&/no road geometry.*travel claim/.test(evidence.lineSemantics);
  if(!automatic&&!authored)throw Error('OFFLINE_ROUTE_EVIDENCE: unrecognized route provenance');
  const observed=automatic?evidence.observedPoints:evidence.sourcePositions;
  const positions=Array.isArray(observed)?observed:[];
  const pointKey=p=>`${Number(p.lat).toFixed(6)},${Number(p.lng).toFixed(6)}`;
  const intended=story.points.map(pointKey).sort(),recorded=positions.map(pointKey).sort();
  const videoHash=automatic?evidence.videoSha256:evidence.routeVideoSha256;
  const recordedDuration=automatic?evidence.durationSeconds:evidence.routeVideoDurationSeconds;
  if(positions.length!==story.points.length||recorded.some((k,i)=>k!==intended[i])||
     !/^[a-f0-9]{64}$/.test(videoHash??'')||videoHash!==sha(await readFile(media)))
   throw Error('OFFLINE_ROUTE_EVIDENCE: visual media or source GPS positions differ');
  await audioCodec(media);
  const duration=await ffprobe(media);
  if(Math.abs(duration-recordedDuration)>0.2)throw Error('OFFLINE_ROUTE_DURATION: evidence does not match rendered bytes');
  return {required:true,path:mediaRel,duration:Number(duration.toFixed(3)),sha256:videoHash,
   evidenceRef:evidenceRel,previewHash:null,output:media,kind:'offline-source-gps-schematic'};
}
export async function buildCinematicEpisode(input,{runDir=process.cwd(),markcutRoot,renderRoute=true}={}){
 const storyPlan=assertAudiovisualStory(input);
 const root=resolve(runDir);
 await mkdir(root,{recursive:true});
 // Scan episode originals by default. GPS cannot be silently ignored because
 // the Director omitted a separate geo.media list.
 const sourceFiles=gpsSourceFiles(input);
 if(sourceFiles.some(f=>!safeName(f)))throw Error('Invalid GPS media file reference');
 const metadata=await readGpsMetadata(sourceFiles.map(p=>resolve(root,p)));
 const evidence={...(input.geo||{}),mediaEvidence:(input.geo?.mediaEvidence||[]).map(m=>({...m,source:resolve(root,m.source)})),
  locationEvidence:(input.geo?.locationEvidence||[]).map(m=>({...m,source:resolve(root,m.source)}))};
 const offlineSelected=input.geo?.offlineRoutePath||input.geo?.visualMethod==='offline-coordinate-schematic';
 const story=input.geo?.required===false
  ? {required:false,kind:'not-applicable',reason:input.geo.reason||'Director selected a mapless story'}
  : offlineSelected ? await verifiedOfflineGeoStory(root,input.geo)
  : planGeoStory(metadata,evidence);
 let route=null;
 if(story.required && (input.geo?.offlineRoutePath||input.geo?.visualMethod==='offline-coordinate-schematic')) {
  const offline=input.geo?.offlineRoutePath ? input.geo : {
   offlineRoutePath:input.geo.visualAsset,offlineEvidencePath:input.geo.visualEvidenceRef
  };
  route=await verifiedOfflineGeoRoute(root,offline,story);
 }
 if(story.required && !route){
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
   locationEvidenceRefs:story.locationEvidenceUsed,factEvidenceRefs:story.factEvidenceUsed,routeEvidenceRef:story.routeEvidenceUsed,travelMode:story.travelMode,scenes:story.scenes.map(s=>({id:s.id,view:s.view,narration:s.text,duration:s.duration})),
   previewHash:preview.contentHash,renderSha256:routeHash};
  await writeFile(join(assetsDir,'evidence.json'),JSON.stringify(publication,null,2));
 }
 const expanded=await preparePlaybackMedia(insertGeoRoute(input,route),{runDir:root});
 const originalCwd=process.cwd();
 try{
  process.chdir(root);
  const markdown=compileCinematicVlog(expanded);
  const issues=lintCinematicVlog(markdown,expanded);
  if(issues.length)throw Error(issues.join('\n'));
  if(route && !markdown.includes('src:assets/route.mp4'))throw Error('REQUIRED_GPS_ROUTE_MISSING');
  const main=resolve(root,'video.md');await writeFile(main,markdown);
  await writeFile(resolve(root,'episode-production.json'),JSON.stringify({route,sourceSceneCount:input.scenes.length,finalSceneCount:expanded.scenes.length,storyPlan,mediaTreatments:expanded.scenes.filter(s=>s.mediaTreatment).map(s=>({sceneId:s.id,originalSource:s.sourceEvidencePath,renderedPath:s.path,...s.mediaTreatment})),status:'draft-needs-review'},null,2));
  return {video:main,route,story,finalSceneCount:expanded.scenes.length};
 } finally {process.chdir(originalCwd);}
}
