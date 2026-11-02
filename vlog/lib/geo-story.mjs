/** Evidence-backed geography for a Vlog. Photo EXIF is a set of observed
 * locations; only an independently recorded track can prove travelled geometry.
 * Markcut's route view uses live Google Directions road geometry between stops.
 */
import {extractRoutePoints,segmentRoute,publicRoutePoints} from './gps-route.mjs';
import {readFileSync} from 'node:fs';

const quote=s=>JSON.stringify(String(s));
const geoTemplate=readFileSync(new URL('../templates/geo-story.md',import.meta.url),'utf8');
const geoBlock=name=>{
 const pattern=new RegExp('<!-- VLOG:'+name+':BEGIN -->\\s*\\n([\\s\\S]*?)\\n<!-- VLOG:'+name+':END -->');
 const match=pattern.exec(geoTemplate);
 if(!match)throw Error('Missing Markcut geo template block '+name);
 return match[1];
};
const geoBind=(block,values)=>block.replace(/\{\{([\w.]+)\}\}/g,(token,key)=>{
 if(!Object.hasOwn(values,key))throw Error('Missing Markcut geo binding '+key);
 return String(values[key]);
});
const geoRender=(name,values)=>geoBind(geoBlock(name),values);

const clampText=(s,max=100)=>String(s??'').replace(/[\n\r\t]/g,' ').trim().slice(0,max);
const shortTime=(iso,timeZone)=>new Intl.DateTimeFormat('zh-CN',{timeZone,hour:'numeric',minute:'2-digit',hour12:false}).format(new Date(iso));
const timeWord=(iso,timeZone)=>{
 const h=Number(new Intl.DateTimeFormat('en-US',{timeZone,hour:'numeric',hourCycle:'h23'}).format(new Date(iso)));
 return h<11?'上午':h<14?'中午':h<18?'下午':'晚上';
};
const verified=x=>x?.status==='verified'&&typeof x.evidenceRef==='string'&&x.evidenceRef.trim();
const isTrustedLabel=x=>verified(x)&&typeof x.name==='string'&&x.name.trim();
const isTrustedFact=x=>verified(x)&&typeof x.fact==='string'&&x.fact.trim()&&typeof x.factEvidenceRef==='string'&&x.factEvidenceRef.trim();

export function planGeoStory(records,{mediaEvidence=[],locationEvidence=[],routeEvidence=null,timeZone='America/Toronto',excludeSources=[],precision=null,routeDuration=9,overviewDuration=4,travelMode}={}){
 const segmented=segmentRoute(extractRoutePoints(records));
 // Never join separate days/implausible time gaps into a fictional continuous journey.
 const segments=segmented.segments.map(s=>s.filter(p=>!p.synthetic&&!excludeSources.includes(p.source))).filter(s=>s.length>=2);
 if(!segments.length)return {required:false,reason:'insufficient-trusted-gps',evidence:segmented,scenes:[]};
 if(segments.length>1)throw Error('MULTIPLE_ROUTE_INTERVALS: Director must choose a contiguous route chapter; never silently discard or join credible GPS intervals');
 const selected=segments[0];
 if(selected.length>24)throw Error('ROUTE_WAYPOINT_LIMIT: split this recorded episode into separate route chapters');
 if(!Number.isFinite(routeDuration)||routeDuration<6||routeDuration>24)throw Error('invalid route duration');
 if(!Number.isFinite(overviewDuration)||overviewDuration<2||overviewDuration>12)throw Error('invalid overview duration');
 if(travelMode&&!['DRIVING','WALKING','BICYCLING','TRANSIT'].includes(travelMode))throw Error('unverified/unsupported travel mode');
 const observed=publicRoutePoints(selected,{precision});
 const loc=p=>locationEvidence.find(x=>x.source===p.source&&isTrustedLabel(x));
 const display=(p,i)=>clampText(loc(p)?.name??`拍摄点${i+1}`,50);
 const sources=selected.map(p=>mediaEvidence.find(m=>m.source===p.source&&m.evidenceRef&&m.observed));
 const facts=selected.map(p=>loc(p)).filter(isTrustedFact).slice(0,2);
 const time=p=>`${timeWord(p.capturedAt,timeZone)}${shortTime(p.capturedAt,timeZone)}`;
 const verifiedRoute=verified(routeEvidence)&&routeEvidence.provider&&Number.isFinite(routeEvidence.distanceKm)&&routeEvidence.distanceKm>0;
 const routeText=verifiedRoute?`地图服务提供的导航距离约${routeEvidence.distanceKm.toFixed(1)}公里。`:'';
 const contents=sources.filter(Boolean).slice(0,2).map(m=>clampText(m.observed,40));
 const texts=[
   `今天的记录从${display(selected[0],0)}开始，最后到了${display(selected.at(-1),selected.length-1)}。这些是原始定位标出的拍摄点。`,
   `从${display(selected[0],0)}到${display(selected.at(-1),selected.length-1)}，拍摄时间是${time(selected[0])}到${time(selected.at(-1))}，记录了${selected.length}个位置。${[routeText,...facts.map(f=>clampText(f.fact,60)),...(contents.length?[`途中拍到了${contents.join('、')}`]:[])].filter(Boolean).join('。')}。地图线是道路导航参考，不冒充完整实测轨迹。`
 ];
 const waypoints=observed.map((p,i)=>`${p.lat},${p.lng},${quote(display(selected[i],i))}`).join('; ');
 const center={lat:(observed[0].lat+observed.at(-1).lat)/2,lng:(observed[0].lng+observed.at(-1).lng)/2};
 const scenes=[
  {id:'geo-overview',view:'overview',duration:overviewDuration,text:texts[0],map:geoRender('MAP_OVERVIEW',{duration:overviewDuration,'center.lat':center.lat,'center.lng':center.lng})},
  {id:'geo-stops',view:'route',duration:routeDuration,text:texts[1],map:geoRender('MAP_ROUTE',{duration:routeDuration,travelMode:travelMode?' travelMode:'+travelMode:'',waypoints})}
 ];
 return {required:true,reason:'verified-source-gps',scenes,points:observed,evidence:segmented,kind:'recorded-stops-with-road-navigation',travelMode:travelMode??'map-default-navigation',locationEvidenceUsed:selected.map(p=>loc(p)?.evidenceRef??null),factEvidenceUsed:facts.map(f=>f.factEvidenceRef),routeEvidenceUsed:verifiedRoute?routeEvidence.evidenceRef:null,mediaEvidenceUsed:sources.map(x=>x?.evidenceRef??null)};
}

export function geoStoryMarkdown(plan,{width=720,height=1280,audioFiles=[]}={}){
 if(!plan.required)throw Error('No trusted GPS story to render');
 if(audioFiles.length!==plan.scenes.length)throw Error('Each geographical scene requires a verified narration track');
 const sceneBlocks=plan.scenes.map((scene,i)=>geoRender('MAP_SCENE',{
  'scene.id':scene.id,
  'scene.instruction':quote(plan.kind+'. '+scene.text),
  'scene.map':scene.map,
  'scene.audio.path':audioFiles[i].path,
  'scene.audio.duration':audioFiles[i].duration
 }));
 const body=geoTemplate.replace(/<!-- VLOG:MAP_(?:SCENE|OVERVIEW|ROUTE):BEGIN -->[\s\S]*?<!-- VLOG:MAP_(?:SCENE|OVERVIEW|ROUTE):END -->\s*/g,'');
 const output=geoBind(body,{width,height,scenes:sceneBlocks.join('\n\n')}).trim()+'\n';
 if(/<!-- VLOG:|\{\{/.test(output))throw Error('Unrendered geo Markcut template directive');
 return output;
}
