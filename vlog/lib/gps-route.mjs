import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execFileAsync=promisify(execFile);
const tag=(r,...keys)=>keys.map(k=>r[k]??Object.entries(r).find(([name])=>name.endsWith(':'+k))?.[1]).find(v=>v!==undefined&&v!==null);
const position=(r)=>{
  const a=tag(r,'GPSLatitude'),b=tag(r,'GPSLongitude');
  if(a!=null&&b!=null)return [Number(a),Number(b)];
  const iso=String(tag(r,'GPSCoordinates','GPSPosition')||'').match(/^([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)/);
  return iso?[Number(iso[1]),Number(iso[2])]:[NaN,NaN];
};
function timeOf(r,{defaultTimezone=null}={}){
  const gps=tag(r,'GPSDateTime');
  const original=tag(r,'DateTimeOriginal','SubSecDateTimeOriginal','MediaCreateDate','TrackCreateDate','CreateDate');
  const raw=gps??original;
  if(!raw)return {status:'missing',raw:null};
  let normalized=String(raw).trim().replace(/^(\d{4}):(\d\d):(\d\d)/,'$1-$2-$3').replace(' ','T');
  let provenance=gps!=null?'gps-utc':'embedded-offset';
  const explicit=/([zZ]|[+-]\d\d:?\d\d)$/.test(normalized);
  if(!explicit){
    const offset=gps!=null?'+00:00':tag(r,'OffsetTimeOriginal','OffsetTimeDigitized','OffsetTime')??defaultTimezone;
    if(!offset)return {status:'ambiguous',raw:String(raw)};
    normalized+=offset==='Z'?'Z':String(offset);
    provenance=gps!=null?'gps-utc':tag(r,'OffsetTimeOriginal','OffsetTimeDigitized','OffsetTime')?'exif-offset':'supplied-timezone';
  }
  const epoch=Date.parse(normalized);
  return Number.isFinite(epoch)?{status:'valid',raw:String(raw),utc:new Date(epoch).toISOString(),epoch,provenance}:{status:'invalid',raw:String(raw)};
}
export async function readGpsMetadata(paths,{exiftool='exiftool'}={}){
  if(!paths.length)return [];
  const {stdout}=await execFileAsync(exiftool,['-json','-n','-a','-G1','-GPSLatitude','-GPSLongitude','-GPSCoordinates','-GPSPosition','-GPSDateTime','-DateTimeOriginal','-SubSecDateTimeOriginal','-CreateDate','-MediaCreateDate','-TrackCreateDate','-OffsetTimeOriginal','-OffsetTime','-GPSHPositioningError',...paths],{maxBuffer:16*1024*1024});
  return JSON.parse(stdout);
}
export function extractRoutePoints(records,options={}){
  return records.flatMap((r,index)=>{
    const [lat,lng]=position(r),clock=timeOf(r,options);
    if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180)return [];
    const source=String(r.SourceFile??'asset-'+index);
    return [{source,lat,lng,capturedAt:clock.utc??null,rawCaptureTime:clock.raw,timeStatus:clock.status,timeProvenance:clock.provenance??null,accuracyMeters:Number.isFinite(Number(tag(r,'GPSHPositioningError')))?Number(tag(r,'GPSHPositioningError')):null,provenance:'original-media-metadata',synthetic:Boolean(r.synthetic)}];
  }).sort((a,b)=>(a.capturedAt??'~').localeCompare(b.capturedAt??'~')||a.source.localeCompare(b.source));
}
export function haversineMeters(a,b){
  const rad=Math.PI/180,dLat=(b.lat-a.lat)*rad,dLon=(b.lng-a.lng)*rad;
  const s=Math.sin(dLat/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(dLon/2)**2;
  return 12742000*Math.asin(Math.min(1,Math.sqrt(s)));
}
export function segmentRoute(points,{maxSpeedKmh=250,maxGapHours=6,maxAccuracyMeters=1000}={}){
  const segments=[],rejected=[];let current=[];
  for(const p of points){
    if(p.timeStatus!=='valid'||!p.capturedAt||!Number.isFinite(p.lat)||!Number.isFinite(p.lng)||p.accuracyMeters!=null&&p.accuracyMeters>maxAccuracyMeters){
      rejected.push({source:p.source,reason:p.timeStatus!=='valid'?'untrusted-time':'invalid-or-inaccurate-gps'});continue;
    }
    const prev=current.at(-1);
    if(prev){
      const hours=(Date.parse(p.capturedAt)-Date.parse(prev.capturedAt))/3600000;
      if(hours<=0){rejected.push({source:p.source,reason:'nonmonotonic-capture-time'});continue;}
      if(haversineMeters(prev,p)/1000/hours>maxSpeedKmh){rejected.push({source:p.source,reason:'implausible-speed'});continue;}
      if(hours>maxGapHours){segments.push(current);current=[];}
    }
    current.push(p);
  }
  if(current.length)segments.push(current);
  return {segments,rejected,evidenceType:'media-gps-samples',trackedMovement:false};
}
export function publicRoutePoints(points,{approved=false,precision=2,excludeSources=[]}={}){
  if(!approved)throw Error('GPS_DISCLOSURE_NOT_APPROVED: route coordinates must be explicitly approved');
  if(!Number.isInteger(precision)||precision<0||precision>5)throw Error('invalid location precision');
  return points.filter(p=>!excludeSources.includes(p.source)).map(p=>({...p,lat:Number(p.lat.toFixed(precision)),lng:Number(p.lng.toFixed(precision)),source:'redacted',rawCaptureTime:null}));
}
export function routeScene(points,{duration=7,view='route',travelMode,disclosureApproved=false}={}){
  if(!disclosureApproved)throw Error('GPS_DISCLOSURE_NOT_APPROVED');
  if(points.length<2)throw Error('INSUFFICIENT_GPS: at least two geotagged media items are required');
  if(!['route','cinematic'].includes(view))throw Error('unsupported map view');
  if(travelMode&&!['DRIVING','WALKING','BICYCLING','TRANSIT'].includes(travelMode))throw Error('unsupported travel mode');
  if(!Number.isFinite(duration)||duration<=0)throw Error('invalid duration');
  const stops=points.map((p,i)=>{
    if(!Number.isFinite(p.lat)||!Number.isFinite(p.lng)||Math.abs(p.lat)>90||Math.abs(p.lng)>180)throw Error('invalid coordinates');
    return `${p.lat},${p.lng},"Stop ${i+1}"`;
  }).join('; ');
  // Locations are observed samples, NOT a recorded continuous route. Travel mode is opt-in only.
  return `- map view:${view} duration:${duration} mapType:roadmap${travelMode?` travelMode:${travelMode}`:''} waypoints:[${stops}]`;
}
