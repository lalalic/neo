/** Route subvideo contract. The main video inserts the rendered MP4 only after a verified render. */
import {optionalRouteScene} from './gps-route.mjs';

export function planRouteSubvideo(records, {disclosureApproved=false, duration=9, precision=2, excludeSources=[]}={}) {
  const route=optionalRouteScene(records,{disclosureApproved,precision,excludeSources});
  if(!route.included) return {required:false,reason:route.reason,videoMd:null,evidence:route.evidence};
  if(!Number.isFinite(duration)||duration<6||duration>12)throw Error('Route overview must be 6–12 seconds');
  const mapLeaf=route.scene.replace(/duration:\d+(?:\.\d+)?/,`duration:${duration}`);
  return {
    required:true, reason:'verified-approved-gps', duration,
    videoMd:['# video','width:1080 height:1920 fps:30 layout:series','', '## Route Overview', 'layout:parallel', 'instruction:"Observed GPS samples only; gaps are not recorded tracks; no inferred travel mode."',mapLeaf,''].join('\n'),
    evidence:route.evidence,
    mainVideoInsertion:{kind:'rendered-video',role:'route-overview',duration,required:true,source:'route.mp4'}
  };
}

export function assertRouteIncluded(plan,mainVideoMarkdown,{renderVerified=false}={}){
  if(!plan.required)return true;
  if(!renderVerified)throw Error('ROUTE_RENDER_NOT_VERIFIED: render route.md to route.mp4 first');
  if(!mainVideoMarkdown.includes('src:route.mp4')&&!mainVideoMarkdown.includes('src:assets/route.mp4'))throw Error('REQUIRED_GPS_ROUTE_MISSING: add rendered Route subvideo to main video.md');
  return true;
}
