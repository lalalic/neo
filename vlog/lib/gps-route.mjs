import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execFileAsync=promisify(execFile);

// ExifTool emits numeric GPS in -n mode. Never infer a missing position.
export async function readGpsMetadata(paths,{exiftool='exiftool'}={}){
  if(!paths.length)return [];
  const {stdout}=await execFileAsync(exiftool,['-json','-n','-GPSLatitude','-GPSLongitude','-GPSDateTime','-DateTimeOriginal','-CreateDate','-GPSHPositioningError',...paths],{maxBuffer:16*1024*1024});
  return JSON.parse(stdout);
}
export function extractRoutePoints(records){
  const points=[];
  for(const r of records){
    const lat=Number(r.GPSLatitude),lng=Number(r.GPSLongitude);
    if(r.GPSLatitude==null||r.GPSLongitude==null||!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180)continue;
    const rawTime=r.GPSDateTime||r.DateTimeOriginal||r.CreateDate;
    if(!rawTime)continue;
    const time=String(rawTime);
    points.push({source:r.SourceFile,lat,lng,capturedAt:time,accuracyMeters:r.GPSHPositioningError??null});
  }
  return points.sort((a,b)=>a.capturedAt.localeCompare(b.capturedAt)||a.source.localeCompare(b.source));
}
export function routeScene(points,{duration=7,view='route',travelMode}={}){
  if(points.length<2)throw Error('INSUFFICIENT_GPS: at least two geotagged media items are required');
  if(!['route','cinematic'].includes(view))throw Error('unsupported map view');
  if(travelMode&&!['DRIVING','WALKING','BICYCLING','TRANSIT'].includes(travelMode))throw Error('unsupported travel mode');
  const stops=points.map((point,index)=>{
    if(!Number.isFinite(point.lat)||!Number.isFinite(point.lng))throw Error('invalid coordinates');
    const label=`Stop ${index+1}`;
    return `${point.lat},${point.lng},"${label}"`;
  }).join('; ');
  // No travelMode by default: do not assert a driving/walking route from GPS snapshots.
  return `- map view:${view} duration:${duration} mapType:roadmap${travelMode?` travelMode:${travelMode}`:''} waypoints:[${stops}]`;
}
