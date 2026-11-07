#!/usr/bin/env node
/** Offline, source-bound GPS position schematic: no Google Maps keys or network. */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync,
  statSync, writeFileSync
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const fail = msg => { throw new Error('offline GPS route: '+msg); };
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const inside = (dir,path) => {
 const rel=relative(dir,path);return rel && rel!=='..'&&!rel.startsWith('..'+sep)&&!isAbsolute(rel);
};
function command(program,args,{cwd,timeout=180000}={}) {
 const result=spawnSync(program,args,{cwd,encoding:'utf8',timeout,maxBuffer:4*1024*1024});
 if(result.error||result.status!==0)fail(program+' failed: '+String(result.stderr||result.error||result.status).slice(0,650));
 return result.stdout;
}
const escapeXml = value => String(value).replace(/[&<>"']/g,char=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'
}[char]));
function safeRunFile(run,relativePath) {
 if(typeof relativePath!=='string'||!relativePath||
    isAbsolute(relativePath)||relativePath.split('/').some(p=>!p||p==='.'||p==='..'))
   fail('invalid Run artifact relative path');
 const full=resolve(run,relativePath),actual=realpathSync(full);
 if(!inside(run,actual)||!statSync(actual).isFile()||statSync(actual).size<128)
   fail('Run artifact missing or unsafe: '+relativePath);
 return actual;
}
function validPosition(location){
 const lat=Number(location?.latitude),lng=Number(location?.longitude);
 return Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180
   ?{lat,lng}:null;
}
export function trustedStops(manifest,intent) {
 if(manifest?.source_use?.approved!==true || !/private/i.test(String(manifest?.source_use?.scope??'')))
  fail('this offline test requires owner-approved private source use');
 if(intent?.decision!=='include'||!Array.isArray(intent.observedStops)||
     intent.observedStops.length<2||intent.observedStops.length>24)fail('Director must choose 2–24 source-linked GPS stops');
 const ids=new Set(),byId=new Map((manifest.media??[]).map(m=>[m.id,m]));
 return intent.observedStops.map((stop,index)=>{
   if(typeof stop.sourceId!=='string'||!stop.evidenceRef||ids.has(stop.sourceId))
     fail('duplicate or unsupported source location '+String(stop.sourceId));
   ids.add(stop.sourceId);
   const media=byId.get(stop.sourceId),point=validPosition(media?.original_location);
   if(!point||!media?.use_approved||media.identity_verified!=='sha256_exact')
     fail('GPS must come from an approved, hash-verified original source: '+stop.sourceId);
   return {index:index+1,sourceId:stop.sourceId,sourceHash:media.sha256,
     capturedAt:media.capture_time_utc??null,...point};
 });
}
export function routeSvg(points,{title='拍摄位置示意图'}={}){
 if(!Array.isArray(points)||points.length<2||points.length>24)fail('need 2–24 source GPS points');
 const minLat=Math.min(...points.map(x=>x.lat)),maxLat=Math.max(...points.map(x=>x.lat));
 const minLng=Math.min(...points.map(x=>x.lng)),maxLng=Math.max(...points.map(x=>x.lng));
 const height=Math.max(0.0001,maxLat-minLat),width=Math.max(0.0001,maxLng-minLng);
 // An equirectangular position plot is NOT a road map or travelled geometry.
 const pins=points.map((p,i)=>{
  const x=(165+(p.lng-minLng)/width*735).toFixed(1);
  const y=(1305-(p.lat-minLat)/height*740).toFixed(1);
  return `<g transform="translate(${x},${y})"><circle r="32" fill="#fff8e8" stroke="#a04c39" stroke-width="5"/>
  <circle r="24" fill="#a04c39"/><text y="9" text-anchor="middle" fill="white" font-family="sans-serif" font-size="27" font-weight="bold">${i+1}</text>
  </g>`;
 }).join('\n');
 const sourceLabels=points.map(p=>`<tspan> ${escapeXml(p.sourceId)}</tspan>`).join('');
 return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">
<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#f5e7c7"/><stop offset="1" stop-color="#cfe2d5"/></linearGradient><pattern id="grid" width="70" height="70" patternUnits="userSpaceOnUse"><path d="M70 0H0V70" fill="none" stroke="#6d897d" stroke-opacity=".16" stroke-width="2"/></pattern></defs>
<rect width="1080" height="1920" fill="url(#bg)"/><rect width="1080" height="1920" fill="url(#grid)"/>
<text x="90" y="165" font-family="sans-serif" font-size="30" fill="#466058">SOURCE-LINKED GPS · POSITION SCHEMATIC</text>
<text x="90" y="282" font-family="sans-serif" font-size="72" font-weight="bold" fill="#243b3b">${escapeXml(title)}</text>
<text x="90" y="358" font-family="sans-serif" font-size="30" fill="#426055">按原始素材中的 GPS 坐标相对排列</text>
<rect x="110" y="495" width="850" height="900" rx="45" fill="#ffffff" fill-opacity=".34" stroke="#9db4a8" stroke-width="3"/>
${pins}
<text x="90" y="1520" font-family="sans-serif" font-size="32" fill="#20333a">本集共有 ${points.length} 个带位置记录的原始素材</text>
<text x="90" y="1615" font-family="sans-serif" font-size="29" fill="#6b5044">仅展示独立拍摄点，不代表真实行进轨迹</text>
<text x="90" y="1690" font-family="sans-serif" font-size="28" fill="#6b5044">无道路、导航距离或行进方式推断</text>
<text x="90" y="1770" font-family="sans-serif" font-size="24" fill="#567065">Source IDs: ${sourceLabels}</text>
</svg>\n`;
}
export function renderOfflineRoute({run,audio='assets/narration/chattts-male/route.m4a',output='assets/route.mp4',tools={}}) {
 if(typeof run!=='string'||!isAbsolute(run))fail('expected absolute --run');
 const root=realpathSync(run);
 const runName=basename(root);
 if(!/^\d{4}-\d{2}-\d{2}-[A-Za-z0-9._-]+$/.test(runName)||
    basename(dirname(root))!=='runs') fail('expected canonical dated Project Run');
 const manifest=JSON.parse(readFileSync(safeRunFile(root,'source-manifest.json'),'utf8'));
 const intent=JSON.parse(readFileSync(safeRunFile(root,'route-intent.json'),'utf8'));
 const points=trustedStops(manifest,intent);
 const narration=safeRunFile(root,audio);
 const probe=JSON.parse((tools.command??command)('ffprobe',['-v','error','-show_entries','format=duration:stream=codec_type','-of','json',narration]));
 const voiceDuration=Number(probe.format?.duration);
 if(!Number.isFinite(voiceDuration)||voiceDuration<0.5||!probe.streams?.some(x=>x.codec_type==='audio'))
   fail('invalid source-linked audio');
 if(output!=='assets/route.mp4')fail('canonical route output must be assets/route.mp4');
 const path=join(root,output),geoDir=join(root,'assets','geo-story');
 if(existsSync(path))fail('route.mp4 already exists; preserve existing media and inspect revision');
 mkdirSync(geoDir,{recursive:true});
 const svg=join(geoDir,'recorded-stops.svg'),frame=join(geoDir,'recorded-stops.png');
 if(existsSync(svg)||existsSync(frame))fail('existing route schematic files must not be overwritten');
 writeFileSync(svg,routeSvg(points),{flag:'wx'});
 const temp=join(geoDir,'route-render.tmp.mp4');
 try{
  (tools.command??command)('rsvg-convert',['-w','1080','-h','1920','-o',frame,svg]);
  const duration=Number((voiceDuration+0.75).toFixed(3));
  (tools.command??command)('ffmpeg',['-hide_banner','-loglevel','error','-y','-loop','1','-framerate','30','-i',frame,
   '-i',narration,'-filter_complex','[1:a]apad=pad_dur=1[a]','-map','0:v','-map','[a]','-t',String(duration),
   '-c:v','libx264','-preset','veryfast','-crf','22','-pix_fmt','yuv420p','-r','30',
   '-c:a','aac','-b:a','128k','-movflags','+faststart',temp],{timeout:240000});
  const check=JSON.parse((tools.command??command)('ffprobe',['-v','error','-show_entries',
   'format=duration:stream=codec_type','-of','json',temp]));
  const actualDuration=Number(check.format?.duration);
  if(!Number.isFinite(actualDuration)||actualDuration<voiceDuration||
    !check.streams?.some(x=>x.codec_type==='video')||!check.streams?.some(x=>x.codec_type==='audio'))fail('offline MP4 missing streams or truncated voice');
  renameSync(temp,path);
  const evidence={schemaVersion:1,kind:'offline-gps-position-schematic',
    status:'VERIFIED',sourceAuthority:'source-manifest.json',routeAuthority:'route-intent.json',
    declaredNoTravelTrack:true,observedPoints:points,voicePath:audio,
    voiceSha256:sha(narration),videoPath:output,videoSha256:sha(path),
    durationSeconds:actualDuration,provider:'local-rsvg-ffmpeg',createdAt:new Date().toISOString()};
  writeFileSync(join(geoDir,'evidence.json'),JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});
  return {status:'PASS',route:{required:true,path:output,duration:actualDuration,sha256:evidence.videoSha256,
    evidenceRef:'assets/geo-story/evidence.json',kind:'offline-source-gps-schematic'},
    observedStops:points.length,audioPath:audio,noMapsApi:true};
 }finally {rmSync(temp,{force:true});rmSync(frame,{force:true});}
}
if(import.meta.url===new URL('file://'+process.argv[1]).href) {
 try{
  const args=process.argv.slice(2);
  if(args.length!==4||args[0]!=='--run'||args[2]!=='--audio')fail('Usage: render-offline-route.mjs --run /absolute/dated-run --audio assets/relative.m4a');
  console.log(JSON.stringify(renderOfflineRoute({run:args[1],audio:args[3]}),null,2));
 }catch(error){console.error(error.message);process.exitCode=1;}
}
