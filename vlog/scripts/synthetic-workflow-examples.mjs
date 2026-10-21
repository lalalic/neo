import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {optionalRouteScene} from '../lib/gps-route.mjs';
export const sha=s=>createHash('sha256').update(s).digest('hex');
export const reviewCurrent=(review,revision)=>review.revisionId===revision.revisionId&&review.contentHash===revision.contentHash&&JSON.stringify(review.dependencies)===JSON.stringify(revision.dependencies);
export const publishGate=(authorization)=>authorization?.explicit===true&&authorization?.realHuman===true?'ELIGIBLE':'HOLD_ARCHIVE_ONLY';
export const isDAG=(edges)=>{const adj=new Map();for(const [u,v] of edges){if(!adj.has(u))adj.set(u,[]);adj.get(u).push(v)}const seen=new Set(),active=new Set();function visit(u){if(active.has(u))return false;if(seen.has(u))return true;active.add(u);for(const v of adj.get(u)||[])if(!visit(v))return false;active.delete(u);seen.add(u);return true}return [...adj.keys()].every(visit)};
export function build(mode,{narrativeValue=true,disclosureScopeApproved=true}={}){
 const tag='SYNTHETIC_NOT_REAL', loc=(id,lat,lng,time)=>({SourceFile:id,GPSLatitude:lat,GPSLongitude:lng,GPSDateTime:time});
 const points=mode==='no-gps'?[{SourceFile:'SYN-N1'},{SourceFile:'SYN-N2'}]:mode==='partial-gps'?[loc('SYN-P1',43.6,-79.3,'2026:10:14 12:00:00'),{SourceFile:'SYN-P2'}]:[loc('SYN-G1',43.6,-79.3,'2026:10:14 12:00:00'),loc('SYN-G2',43.7,-79.4,'2026:10:14 13:00:00')];
 const route=optionalRouteScene(points,{disclosureApproved:mode==='gps-enhanced'&&narrativeValue&&disclosureScopeApproved});
 const manifest={classification:tag,permission:'SIMULATED_ONLY_NOT_REAL',sources:points.map((p,i)=>({sourceId:p.SourceFile,sha256:'SIMULATED-'+i,source:'GENERATED_PLACEHOLDER',gpsStatus:p.GPSLatitude===undefined?'absent':'synthetic-point',gpsProvenance:p.GPSLatitude===undefined?null:'SIMULATED_EXIF',rights:'SIMULATED_NOT_LICENSED'}))};
 const labels=['开场镜头','发展镜头','收束镜头'];let video='# video\nseed:1021\nwidth:640 height:480 fps:30 layout:series\n';
 for(let i=0;i<3;i++)video+=`\n## ${['Hook','Development','Payoff'][i]}\n- component duration:${i===2?2:3} jsx:"<div style={{background:'#174EA6',color:'white',width:'100%',height:'100%',display:'flex',alignItems:'center',justifyContent:'center'}}>SYNTHETIC ${labels[i]}</div>"\n`;
 if(route.included) video+=`\n## Map-context-synthetic-not-recorded\n${route.scene}\n`;
 const rev1={revisionId:mode+'-r1',contentHash:sha(video),dependencies:{sourceManifestHash:sha(JSON.stringify(manifest)),storyHash:'SYN-STORY-1',musicPlanHash:'SYN-BGM-UNLICENSED',captionHash:'SYN-C1'}};
 const rev2={revisionId:mode+'-r2',contentHash:sha(video+'\n# revised caption: 示意地点连接（并非实际轨迹）\n'),dependencies:{...rev1.dependencies,captionHash:'SYN-C2'}};
 const output={classification:tag,mode,manifest,routeIncluded:route.included,routeReason:route.reason,routeScene:route.scene,trackedMovement:route.evidence.trackedMovement,beats:[{source:manifest.sources[0].sourceId,role:'hook',start:0,end:3},{source:manifest.sources.at(-1).sourceId,role:'development',start:3,end:6},{source:manifest.sources.at(-1).sourceId,role:'payoff',start:6,end:8}],sound:'SIMULATED_ORIGINAL_SOUND_PLACEHOLDER',bgm:'SIMULATED_LICENSE_NOT_GRANTED',captions:'SIMULATED_WEBVTT_INTENT',qa:{structural:'PASS',hostedPlayback:'NOT_RUN',audio:'NOT_RUN'},revisions:{rev1,changesRequested:'SIMULATED changes_requested: clarify continuous-journey implication',rev2,oldReviewValidForNew:reviewCurrent(rev1,rev2),secondReview:'SIMULATED_REVIEW_ONLY'},publication:publishGate(null),video};
 return output;
}
const called=process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1];
if(called){const dir=process.argv[2];if(!dir)throw Error('output directory required');for(const mode of ['no-gps','partial-gps','gps-enhanced']){const v=build(mode),dest=join(dir,mode);mkdirSync(dest,{recursive:true});writeFileSync(join(dest,'source-manifest.json'),JSON.stringify(v.manifest,null,2));writeFileSync(join(dest,'video.md'),v.video);writeFileSync(join(dest,'result.json'),JSON.stringify({...v,video:undefined},null,2));}console.log('SYNTHETIC examples: no-gps partial-gps gps-enhanced');}
