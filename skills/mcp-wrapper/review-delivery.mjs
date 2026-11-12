/** Neo wrapper-owned durable delivery queue. The phone owns review history. */
import {readFileSync,writeFileSync,renameSync,mkdirSync,readdirSync,statSync,openSync,closeSync,unlinkSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {randomUUID} from 'node:crypto';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// A notification delivered to APNs is NOT proof the phone stored its review.
// Keep request records for 30 days (longer than Markcut's operation TTL).
const RETAIN_MS=30*24*60*60*1000;
export const defaultDirectory=()=>process.env.NEOY_PREVIEW_DELIVERY_DIR ||
 join(homedir(),'Library','Application Support','NeoY','apns','preview-requests');
export function recordPath(id,directory=defaultDirectory()){
 if(!UUID.test(id))throw Error('Invalid review request ID');
 return join(directory,id.toLowerCase()+'.json');
}
export function writeJSON(file,data){
 mkdirSync(join(file,'..'),{recursive:true,mode:0o700});
 const tmp=file+'.'+process.pid+'.'+randomUUID()+'.tmp';
 writeFileSync(tmp,JSON.stringify(data),{flag:'wx',mode:0o600});
 try{renameSync(tmp,file);}catch(e){try{unlinkSync(tmp);}catch{}throw e;}
}
function withLock(file,action){
 mkdirSync(join(file,'..'),{recursive:true,mode:0o700});
 const name=file+'.acquire-lock';
 let fd;
 for(let i=0;i<200;i++){
  try{fd=openSync(name,'wx',0o600);break;}catch(e){
   if(e.code!=='EEXIST')throw e;
   try{if(Date.now()-statSync(name).mtimeMs>30_000)unlinkSync(name);}catch{}
   Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,20);
  }
 }
 if(fd===undefined)throw Error('Review request delivery busy');
 try{return action();}finally{closeSync(fd);try{unlinkSync(name);}catch{}}
}
function validateReviewRequest(request){
 const HASH=/^[0-9a-f]{64}$/;
 if(!request||typeof request!=='object'||!UUID.test(request.id||'')||
    typeof request.title!=='string'||request.title.length<1||request.title.length>180)
   throw Error('Invalid review request');
 const delivery=request.delivery||'text';
 if(delivery==='event'){
  if(!HASH.test(request.mediaHash||'')||request.contentHash!==undefined||request.revisionId!==undefined)
   throw Error('Invalid event media identity');
  const t=request.eventTemplate;
  if(!t||typeof t!=='object'||Array.isArray(t)||
     typeof t.type!=='string'||!/^[A-Za-z0-9_.:-]{1,128}$/.test(t.type)||
     typeof t.source!=='string'||!t.source||t.source.length>512||/[\x00-\x1f]/.test(t.source)||
     !t.data||typeof t.data!=='object'||Array.isArray(t.data)||
     Object.keys(t).some(k=>!['type','source','data','responseKey'].includes(k)))
   throw Error('Invalid event template');
  const response=t.responseKey||'review';
  if(!/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(response)||
     ['__proto__','constructor','prototype'].includes(response))throw Error('Invalid response target');
  if(t.data[response]!==undefined){
   if(!t.data[response]||typeof t.data[response]!=='object'||Array.isArray(t.data[response])||
      ['decision','feedback','comments','previewId','requestId','idempotencyKey']
       .some(k=>Object.hasOwn(t.data[response],k)))throw Error('Invalid prefilled response');
  }
  function safe(value){
   if(value&&typeof value==='object')for(const [key,child] of Object.entries(value)){
    if(['__proto__','constructor','prototype'].includes(key))throw Error('Unsafe template field');
    safe(child);
   }
  }
  safe(t.data);
  if(JSON.stringify(t.data).length>12000)throw Error('Event template too large');
 }else if(delivery==='text'){
  if(!HASH.test(request.contentHash||'')||typeof request.revisionId!=='string'||
      !request.revisionId||request.revisionId.length>256||request.eventTemplate!==undefined)
    throw Error('Invalid text review identity');
 }else throw Error('Unsupported review delivery');
 return request;
}
export function preserveRequest(request,{directory=defaultDirectory()}={}){
 validateReviewRequest(request);
 const id=request.id;
 const file=recordPath(id,directory);
 return withLock(file,()=>{
  const previous=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):null;
  if(previous?.request&&JSON.stringify(previous.request)!==JSON.stringify(request))
   throw Error('Conflicting review request ID');
  const record={...previous,operationId:id,status:'available',
   request,createdAt:previous?.createdAt||new Date().toISOString(),
   acknowledgedBy:previous?.acknowledgedBy||{}};
  writeJSON(file,record);
  return record;
 });
}
export function pruneExpiredDeliveries(directory=defaultDirectory(),now=Date.now()){
 let names=[];
 try{names=readdirSync(directory)}catch(e){if(e.code==='ENOENT')return 0;throw e;}
 let deleted=0;
 for(const name of names){
  if(!UUID.test(name.slice(0,-5))||!name.endsWith('.json'))continue;
  const file=join(directory,name);
  try{
   const record=JSON.parse(readFileSync(file,'utf8'));
   if(!record.request)continue; // Incomplete watcher intent is not a review receipt.
   if(!Number.isFinite(Date.parse(record.createdAt))||
      Date.parse(record.createdAt)>=now-RETAIN_MS)continue;
   withLock(file,()=>{
    const updated=JSON.parse(readFileSync(file,'utf8'));
    if(updated.request&&Date.parse(updated.createdAt)<now-RETAIN_MS){unlinkSync(file);deleted++;}
   });
  }catch(e){if(e.code!=='ENOENT')throw e;}
 }
 return deleted;
}
export function acquireReviews({requestId,ackIds=[],deviceId,directory=defaultDirectory()}={}){
 if(typeof deviceId!=='string'||!UUID.test(deviceId))throw Error('Valid deviceId required');
 if(requestId!==undefined&&!UUID.test(requestId))throw Error('Invalid requestId');
 if(!Array.isArray(ackIds)||ackIds.length>100||ackIds.some(id=>!UUID.test(id)))throw Error('Invalid ackIds');
 if(requestId!==undefined&&ackIds.length)throw Error('Request lookup and acknowledgements must be separate');
 pruneExpiredDeliveries(directory);
 const acked=[];
 for(const id of [...new Set(ackIds)]){
  const file=recordPath(id,directory);
  if(!existsSync(file))continue;
  withLock(file,()=>{
   if(!existsSync(file))return;
   const entry=JSON.parse(readFileSync(file,'utf8'));
   if(!entry.request)return;
   entry.acknowledgedBy={...entry.acknowledgedBy,[deviceId.toLowerCase()]:new Date().toISOString()};
   writeJSON(file,entry);acked.push(id);
  });
 }
 let names=[];
 try{names=requestId?[requestId.toLowerCase()+'.json']:readdirSync(directory).filter(n=>UUID.test(n.slice(0,-5))&&n.endsWith('.json'));}
 catch(e){if(e.code!=='ENOENT')throw e;}
 const requests=[];
 for(const name of names){
  const file=join(directory,name);
  let entry;
  try{entry=JSON.parse(readFileSync(file,'utf8'));}catch{continue;}
  if(!entry.request||!UUID.test(entry.request.id)||entry.request.id.toLowerCase()!==name.slice(0,-5))continue;
  const created=Date.parse(entry.createdAt);
  if(!Number.isFinite(created)||created<Date.now()-RETAIN_MS)continue;
  if(!requestId&&entry.acknowledgedBy?.[deviceId.toLowerCase()])continue;
  requests.push({...entry.request,createdAt:entry.createdAt});
 }
 requests.sort((a,b)=>(a.createdAt||'').localeCompare(b.createdAt||''));
 return {requests:requests.slice(0,100),acked,hasMore:requests.length>100};
}
export function markDeliveryStatus(id,status,{directory=defaultDirectory(),error}={}){
 const file=recordPath(id,directory);
 return withLock(file,()=>{
  const current=JSON.parse(readFileSync(file,'utf8'));
  const updated={...current,status,updatedAt:new Date().toISOString(),...(error?{error}:{})};
  writeJSON(file,updated);
  return updated;
 });
}
export function importLegacyInbox({directory=defaultDirectory(),legacyPath=join(homedir(),'Library','Application Support','NeoY','apns','reviews.json')}={}){
 if(!existsSync(legacyPath))return {imported:0};
 const legacy=JSON.parse(readFileSync(legacyPath,'utf8'));
 if(legacy.version!==1||!legacy.requests||typeof legacy.requests!=='object')throw Error('Invalid legacy review data');
 let count=0;
 for(const row of Object.values(legacy.requests)){
  let request=row?.review;
  if(!request?.id||!UUID.test(request.id))continue;
  // One-time normalization for an older event envelope already stored in
  // reviews.json. Live requests are never accepted in this legacy shape.
  if(request.delivery==='event'&&!request.mediaHash&&/^[0-9a-f]{64}$/.test(request.contentHash||'')){
   const {contentHash,revisionId,...current}=request;
   request={...current,mediaHash:contentHash};
  }
  const file=recordPath(request.id,directory);
  // No migration overwrite: current durable wrapper record wins.
  if(!existsSync(file)||!JSON.parse(readFileSync(file,'utf8')).request){
   preserveRequest(request,{directory});
   // Preserve the original receipt time for stable historical ordering.
   if(row.createdAt){const item=JSON.parse(readFileSync(file,'utf8'));item.createdAt=row.createdAt;writeJSON(file,item);}
   count++;
  }
 }
 return {imported:count};
}
export const acquireTool={
 name:'review.preview.acquire',
 description:'Neo Mobile only: fetch an immutable pending preview by requestId or list undelivered previews, then acknowledge after durable local import. Not a review decision.',
 inputSchema:{type:'object',additionalProperties:false,required:['deviceId'],properties:{
  deviceId:{type:'string'},requestId:{type:'string'},ackIds:{type:'array',items:{type:'string'},maxItems:100}
 }}
};
export async function acquireCall(args){
 const result=acquireReviews(args);
 return {content:[{type:'text',text:JSON.stringify({requests:result.requests.length,acked:result.acked.length})}],structuredContent:result};
}
