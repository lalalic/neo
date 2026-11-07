import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { scope, file, digest, command, parseResult } from './_vlog-contract.mjs';

const allowed=new Set(['wechat-channels','xhs']);
const chars=s=>Array.from(s).length;
function validateTarget(t){
 if(!t||!allowed.has(t.platform)||!['publish','draft'].includes(t.action)||
    t.authorized!==true||typeof t.account!=='string'||!t.account.trim())
   throw Error('target platform, account, action and explicit authorization required');
 if(typeof t.title!=='string'||typeof t.description!=='string'||!t.description.trim())throw Error('target title and description required');
 const min=t.platform==='wechat-channels'?6:1,max=t.platform==='wechat-channels'?16:20;
 if(chars(t.title)<min||chars(t.title)>max||chars(t.description)>1000)
   throw Error('platform title/description length invalid');
 if(t.tags!==undefined&&(!Array.isArray(t.tags)||t.tags.some(s=>typeof s!=='string'||!s.trim())||(t.platform==='xhs'&&t.tags.length>5)))throw Error('invalid platform tags');
}
function statusFrom(platform,data,action){
 const status=data.status;
 if(action==='draft')return {status:status==='draft'?'draft':'unknown',verified:false,identifier:null};
 const identifier=platform==='xhs'?data.note_id:data.post_id;
 const verified=platform==='xhs'?Boolean(identifier):data.verified===true;
 const good=['published','reviewing'].includes(status)&&verified&&Boolean(identifier);
 return {status:good?status:'unknown',verified:good,identifier:good?identifier:null};
}
export async function run(context){
 const {project,run}=await scope(context);
 // Explicit private render tests cannot publish, even if an unrelated
 // per-platform request file was accidentally placed in the Run.
 try{
   const mode=JSON.parse(await readFile(await file(run,'review-mode.json'),'utf8'));
   if(mode.schemaVersion===1&&mode.mode==='private-render-test'&&mode.publicationAllowed===false)
     return {status:'COMPLETED',output:{publicationStatus:'SKIPPED',reason:'private render test prohibits publication'},artifacts:[]};
   throw Error('unrecognized review-mode policy; publication blocked');
 }catch(error){if(error.code!=='ENOENT')throw error;}
 let requestPath;
 try{requestPath=await file(run,'publisher-request.json')}catch(e){
   if(e.code==='ENOENT')return {status:'COMPLETED',output:{publicationStatus:'SKIPPED',reason:'no explicit publication request'},artifacts:[]};
   throw e;
 }
 const request=JSON.parse(await readFile(requestPath,'utf8'));
 if(request.schemaVersion!==1||typeof request.videoSha256!=='string'||!Array.isArray(request.targets)
    ||!request.targets.length||request.targets.length>2)throw Error('invalid publisher-request.json');
 const names=new Set(request.targets.map(t=>t.platform));
 if(names.size!==request.targets.length)throw Error('duplicate target platform');
 for(const t of request.targets)validateTarget(t);
 const video=await file(run,'output/video.mp4');
 const hash=await digest(video);
 const production=JSON.parse(await readFile(await file(run,'production-receipt.json'),'utf8'));
 if(hash!==request.videoSha256||hash!==production.videoSha256||production.status!=='RENDERED')
   throw Error('publisher request does not authorize exact Producer MP4 bytes');
 const results=[],artifacts=[];
 await mkdir(join(run,'publish'),{recursive:true});
 for(const target of request.targets){
   // A fresh observed login/account confirmation is required; a saved owner label
   // or the platform Action's implicit session is not evidence of which account is signed in.
   const evidence=JSON.parse(await readFile(await file(run, 'publish/'+target.platform+'-account-check.json'),'utf8'));
   const age=Date.now()-Date.parse(evidence.verifiedAt);
   if(evidence.platform!==target.platform||evidence.account!==target.account||
      evidence.method!=='webhelm-live-profile'||!Number.isFinite(age)||age<0||age>3600000||
      typeof evidence.observation!=='string'||!evidence.observation.trim())
     throw Error('publisher account not freshly verified via signed-in live profile: '+target.platform);
   const receiptPath=join(run,'publish',target.platform+'-receipt.json');
   // A verified receipt may be reused on retry; an attempted action with
   // no verified result must be inspected on-platform, never posted twice.
   try{
     const existing=JSON.parse(await readFile(receiptPath,'utf8'));
     if(existing.platform!==target.platform||existing.videoSha256!==hash||
       existing.account!==target.account||existing.action!==target.action||
       (target.action==='publish' && !(['published','reviewing'].includes(existing.status)&&existing.verified===true&&existing.identifier))||
       (target.action==='draft' && existing.status!=='draft'))
       throw Error('prior platform attempt cannot safely be reused: '+target.platform);
     results.push(existing);artifacts.push(receiptPath);
     continue;
   }catch(error){if(error.code!=='ENOENT')throw error;}
   try{await file(run,'publish/'+target.platform+'-attempt.json');throw Error('ambiguous prior platform attempt; inspect platform manager: '+target.platform)}
   catch(error){if(error.code!=='ENOENT')throw error;}
   const cfg=target.platform==='xhs'?
    {mode:'video',video,title:target.title,body:target.description,tags:target.tags||[],action:target.action}:
    {video,title:target.title,desc:target.description,tags:target.tags||[],publish:target.action==='publish',draft:target.action==='draft'};
   const configPath=join(run,'publish',target.platform+'-config.json');
   await writeFile(configPath,JSON.stringify(cfg,null,2)+'\n',{flag:'wx'});
   // Atomic attempt fence: do not re-submit after an uncertain browser result.
   const attemptPath=join(run,'publish',target.platform+'-attempt.json');
   await writeFile(attemptPath,JSON.stringify({schemaVersion:1,status:'ATTEMPTED',videoSha256:hash,action:target.action,account:target.account,startedAt:new Date().toISOString()},null,2)+'\n',{flag:'wx'});
   const raw=await command(context,['webhelm','platform','run',target.platform,'post','--auto-session','--config',configPath],project);
   const platformResult=parseResult(raw.stdout);
   const outcome=statusFrom(target.platform,platformResult,target.action);
   const receipt={schemaVersion:1,platform:target.platform,account:target.account,
     action:target.action,videoSha256:hash,...outcome,platformResult,recordedAt:new Date().toISOString()};
   await writeFile(receiptPath,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
   results.push(receipt);artifacts.push(receiptPath);
   if(outcome.status==='unknown')throw Error('uncertain platform post; inspect creator manager before any retry: '+target.platform);
 }
 const check=await command(context,[process.execPath,join(project,'scripts/validate-stage.mjs'),'publisher',run],run);
 if(JSON.parse(check.stdout)?.status!=='PASS')throw Error('publisher stage validation did not PASS');
 return {status:'COMPLETED',output:{results},artifacts};
}
export default {run};
