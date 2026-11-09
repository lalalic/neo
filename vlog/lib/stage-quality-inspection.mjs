/** Stage-local artifact-quality evidence for Vlog. No model/API, no file writes.
 * These signals are advisory; only canonical Stage validators issue technical PASS.
 */
import {readFileSync,existsSync,statSync} from 'node:fs';
import {join,resolve,relative,sep} from 'node:path';
import {spawnSync} from 'node:child_process';
const file=(run,path,maxBytes=120000)=>{
 const root=resolve(run),target=resolve(run,path),rel=relative(root,target);
 if(!rel||rel==='..'||rel.startsWith('..'+sep)||!existsSync(target))return null;
 if(!statSync(target).isFile())return null;
 if(statSync(target).size>maxBytes)return null;
 return readFileSync(target,'utf8');
};
const json=(run,path)=>{const raw=file(run,path);if(!raw)return null;try{return JSON.parse(raw)}catch{return null}};
const problem=(code,why)=>({code,message:why,severity:'question'});
const mediaProbe=(run,path)=>{
 if(typeof path!=='string'||!path.startsWith('output/'))return null;
 const target=resolve(run,path),rel=relative(resolve(run),target);
 if(!rel||rel.startsWith('..')||!existsSync(target)||!statSync(target).isFile())return null;
 const child=spawnSync('ffprobe',['-v','error','-show_entries','format=duration,size:stream=codec_type,codec_name,width,height','-of','json',target],
  {encoding:'utf8',timeout:15000,maxBuffer:200000});
 if(child.status!==0)return {status:'UNPROBED',error:child.error?.message??'ffprobe failed'};
 try{return {status:'PROBED',...JSON.parse(child.stdout)}}catch{return {status:'UNPROBED',error:'Invalid ffprobe JSON'}};
};
export function inspectVisioner(run,manifest){
 const vision=json(run,'vision-evidence.json'),norm=json(run,'vision-normalized-manifest.json');
 if(!vision)return {stage:'visioner',status:'NOT_EVALUATED',reason:'Missing canonical vision-evidence.json'};
 const ids=new Set((manifest?.media??[]).map(m=>m.id));
 const bound=(vision.sources??vision.summary??[]).map(x=>x.source_id);
 const observations=vision.observations??[];
 const missing=[...ids].filter(id=>!bound.includes(id));
 const questionable=observations.filter(o=>!ids.has(o.source_id)||!Number.isFinite(o.source_time_start_seconds)||!Number.isFinite(o.source_time_end_seconds));
 const notes=[];
 if(missing.length)notes.push(problem('VISION_SOURCE_GAPS','Approved original sources without usable perception evidence: '+missing.join(',')));
 if(questionable.length)notes.push(problem('VISION_UNLINKED_OBSERVATIONS',questionable.length+' observations have missing source/time identity'));
 if(!norm)notes.push(problem('VISION_NO_NORMALIZED_MANIFEST','Visioner lacks its lightweight perception source manifest'));
 if(!Array.isArray(vision.creator_intent_annotations))notes.push(problem('VISION_NO_CREATOR_INTENT_FIELD','Legacy evidence may lack Hey Neo annotations; do not assume no such speech'));
 return {stage:'visioner',status:'INSPECTED',metrics:{sourceCount:ids.size,sourceEvidenceCount:bound.length,observationCount:observations.length,
  uncertainCount:vision.uncertainty?.length??0,creatorIntentCount:vision.creator_intent_annotations?.length??null,
  normalizedSourceCount:norm?.sources?.length??0},signals:notes};
}
export function inspectProducer(run){
 const receipt=json(run,'production-receipt.json');
 if(!receipt)return {stage:'producer',status:'NOT_EVALUATED',reason:'Missing production-receipt.json'};
 const videoPath=receipt.videoPath||'output/video.mp4',probe=mediaProbe(run,videoPath);
 const notes=[];
 if(receipt.status!=='RENDERED')notes.push(problem('PRODUCER_NOT_RENDERED','No confirmed RENDERED receipt'));
 if(probe?.status!=='PROBED')notes.push(problem('PRODUCER_MEDIA_UNPROBED','Rendered media is missing or not decodable by ffprobe'));
 else if(!probe.streams?.some(x=>x.codec_type==='video')||!probe.streams?.some(x=>x.codec_type==='audio'))
  notes.push(problem('PRODUCER_AUDIO_VIDEO','Rendered media lacks confirmed audio and video streams'));
 if(probe?.status==='PROBED'&&Number.isFinite(receipt.durationSeconds)&&
    Math.abs(Number(probe.format?.duration)-receipt.durationSeconds)>0.2)
  notes.push(problem('PRODUCER_DURATION_MISMATCH','Receipt and actual media duration do not match'));
 return {stage:'producer',status:'INSPECTED',metrics:{receiptStatus:receipt.status,videoMdSha256:receipt.videoMdSha256??null,
  videoSha256:receipt.videoSha256??null,videoPath,receiptSeconds:receipt.durationSeconds??null,
  probeStatus:probe?.status??'MISSING',probeDuration:probe?.format?.duration??null,
  streamTypes:probe?.streams?.map(x=>x.codec_type)??[]},signals:notes};
}
export function inspectPublisher(run){
 const request=json(run,'publisher-request.json');
 const receiptPaths=['publish/wechat-receipt.json','publish/xhs-receipt.json',
  'publish/wechat-channels-receipt.json','publish/xiaohongshu-receipt.json'];
 const receipts=receiptPaths.map(path=>({path,receipt:json(run,path)})).filter(x=>x.receipt);
 if(!request&&!receipts.length)return {stage:'publisher',status:'SKIPPED_NO_AUTHORIZATION',
  reason:'No publisher request or publication receipt; no external publishing is authorized'};
 const notes=[];
 if(!request&&receipts.length)notes.push(problem('PUBLISHER_NO_AUTHORIZATION','A platform receipt exists without an explicit publication request'));
 for(const item of receipts){if(!item.receipt?.status)notes.push(problem('PUBLISHER_RECEIPT_STATUS','Receipt lacks explicit status: '+item.path));}
 if(request&&!receipts.length)notes.push(problem('PUBLISHER_NO_PLATFORM_RECEIPT','Authorization exists, but there is no platform receipt for independent confirmation'));
 return {stage:'publisher',status:'INSPECTED',metrics:{hasAuthorization:Boolean(request),receiptPaths:receipts.map(x=>x.path),
   receiptStatuses:receipts.map(x=>x.receipt.status??'MISSING')},signals:notes};
}
/** Redact account secrets before sending local artifacts to an external judge. */
export function redactJudgeData(value){
 if(Array.isArray(value))return value.map(redactJudgeData);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[
  key,/(?:password|access[_-]?token|refresh[_-]?token|api[_-]?key|client[_-]?secret|session[_-]?cookie|authorization[_-]?header|bearer[_-]?token|oauth[_-]?code)/i.test(key)
   ?'[REDACTED]':redactJudgeData(item)]));
 return value;
}
export function stageQualityArtifacts(run,stage){
 const mapping={
  visioner:['source-manifest.json','vision-evidence.json','vision-normalized-manifest.json'],
  director:['source-manifest.json','vision-evidence.json','story.md','personal-story.md','visual-brief.md','post.md','shot-selection.json','route-intent.json'],
  editor:['source-manifest.json','story.md','personal-story.md','visual-brief.md','video.md','edit-decision-list.json','music-plan.json','episode-input.json'],
  producer:['video.md','production-receipt.json'],
  publisher:['post.md','publisher-request.json','production-receipt.json',
   'publish/wechat-receipt.json','publish/xhs-receipt.json','publish/wechat-channels-receipt.json','publish/xiaohongshu-receipt.json'],
 };
 const selected=mapping[stage];if(!selected)throw Error('Unknown stage '+stage);
 const artifacts=Object.fromEntries(selected.map(name=>[name,name.endsWith('.json')?json(run,name):file(run,name)]).filter(([,v])=>v!==null));
 return redactJudgeData(artifacts);
}
