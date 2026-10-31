/** Vlog Director's deterministic, evidence-bound geographic story plan.
 * No GPS-derived motion claim: isolated EXIF locations are observations, not tracks.
 */
import {extractRoutePoints,segmentRoute,publicRoutePoints} from './gps-route.mjs';

const quote=s=>JSON.stringify(String(s));
const clampText=s=>String(s??'').replace(/[\n\r\t]/g,' ').trim().slice(0,160);
const shortTime=(iso,timeZone)=>new Intl.DateTimeFormat('zh-CN',{timeZone,hour:'numeric',minute:'2-digit',hour12:false}).format(new Date(iso));
const timeWord=(iso,timeZone)=>{
 const h=Number(new Intl.DateTimeFormat('en-US',{timeZone,hour:'numeric',hourCycle:'h23'}).format(new Date(iso)));
 return h<11?'上午':h<14?'中午':h<18?'下午':'晚上';
};
const isTrustedLabel=x=>x&&typeof x.name==='string'&&x.name.trim()&&typeof x.evidenceRef==='string'&&x.evidenceRef.trim()&&x.status==='verified';

export function planGeoStory(records,{disclosureApproved=false,mediaEvidence=[],locationEvidence=[],timeZone='America/Toronto',excludeSources=[],precision=3,routeDuration=12,overviewDuration=4}={}){
 const segmented=segmentRoute(extractRoutePoints(records));
 const selected=segmented.segments.flat().filter(p=>!p.synthetic&&!excludeSources.includes(p.source));
 if(selected.length<2)return {required:false,reason:'insufficient-trusted-gps',evidence:segmented,scenes:[]};
 if(!disclosureApproved)throw Error('GPS_DISCLOSURE_REQUIRED: valid location evidence needs disclosure approval before production');
 if(!Number.isFinite(routeDuration)||routeDuration<6||routeDuration>24)throw Error('invalid route duration');
 const safe=publicRoutePoints(selected,{approved:true,precision});
 const chosen=[safe[0],safe.at(-1)];
 const original=[selected[0],selected.at(-1)];
 // Only describe content backed by a Vision/owner statement and a stable source ID.
 const lookup=p=>mediaEvidence.find(m=>m.source===p.source&&m.evidenceRef&&m.observed);
 const location=p=>{
  const x=locationEvidence.find(x=>x.source===p.source&&isTrustedLabel(x));
  return x?.name.trim()||'一个拍摄位置';
 };
 const clock=p=>`${timeWord(p.capturedAt,timeZone)}${shortTime(p.capturedAt,timeZone)}`;
 const descriptions=original.map(p=>lookup(p));
 const texts=[
   `这些照片记录了两个真实的拍摄位置。时间从${clock(chosen[0])}到${clock(chosen[1])}。`,
   `${clock(chosen[0])}，在${location(original[0])}拍下的照片${descriptions[0]?`，画面里有${clampText(descriptions[0].observed)}`:''}。${clock(chosen[1])}，另一张照片${descriptions[1]?`记录着${clampText(descriptions[1].observed)}`:'记录了另一个位置'}。地图蓝线是导航参考，不是实际记录的移动轨迹。`
 ];
 const waypoints=chosen.map((p,i)=>`${p.lat},${p.lng},${quote(i===0?'先前拍摄点':'后来拍摄点')}`).join('; ');
 const center={lat:(chosen[0].lat+chosen[1].lat)/2,lng:(chosen[0].lng+chosen[1].lng)/2};
 const scenes=[
  {id:'geo-overview',view:'overview',duration:overviewDuration,text:texts[0],map:`- map view:overview duration:${overviewDuration} mapType:satellite center:{lat:${center.lat},lng:${center.lng}} camera:{zoom:tween(10,13,easeInOut)}`},
  {id:'geo-stops',view:'route',duration:routeDuration,text:texts[1],map:`- map view:route duration:${routeDuration} mapType:roadmap routeMarker:${quote('📍')} waypoints:[${waypoints}]`}
 ];
 return {required:true,reason:'verified-observed-photo-locations',scenes,points:chosen,evidence:segmented,kind:'observed-stops-not-tracked-route',locationEvidenceUsed:original.map(p=>locationEvidence.find(x=>x.source===p.source&&isTrustedLabel(x))?.evidenceRef||null),mediaEvidenceUsed:descriptions.map(x=>x?.evidenceRef||null)};
}

export function geoStoryMarkdown(plan,{width=720,height=1280,audioFiles=[]}={}){
 if(!plan.required)throw Error('No trusted GPS story to render');
 if(audioFiles.length!==plan.scenes.length)throw Error('Each geographical scene requires a verified narration track');
 return ['# video',`width:${width} height:${height} fps:30 layout:series stt:false`,'',
   ...plan.scenes.flatMap((s,i)=>[`## ${s.id}`,'layout:parallel',`instruction:${quote(`${plan.kind}. ${s.text}`)}`,s.map,
     `- audio src:${audioFiles[i].path} duration:${audioFiles[i].duration} volume:1`,''])].join('\n');
}
