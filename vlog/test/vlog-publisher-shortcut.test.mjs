import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run as publish } from '../agents/.shortcut/vlog-publisher.agent.mjs';
import { run as produce,assertMarkcutAutoSeedOnly } from '../agents/.shortcut/vlog-producer.agent.mjs';

const hash=s=>createHash('sha256').update(s).digest('hex');
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'neo-vlog-publish-test-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const project=join(root,'vlog'),run=join(project,'runs','2026-11-06-test');
 await mkdir(join(run,'output'),{recursive:true});await mkdir(join(run,'publish'),{recursive:true});
 const video=join(run,'output','video.mp4');await writeFile(video,'fixture MP4 bytes');
 const digest=hash('fixture MP4 bytes');
 await writeFile(join(run,'production-receipt.json'),JSON.stringify({status:'RENDERED',videoSha256:digest,videoMdSha256:'test'}));
 return {root,project,run,video,digest};
}
const target=(platform,action='publish')=>({platform,account:'owner channel',action,
 title:platform==='wechat-channels'?'周末骑车故事':'出门骑车的故事',description:'一次很有意思的骑行',tags:['cycling'],authorized:true});
async function prepare(f,targets){
 await writeFile(join(f.run,'publisher-request.json'),JSON.stringify({schemaVersion:1,videoSha256:f.digest,targets}));
 for(const t of targets)await writeFile(join(f.run,'publish',t.platform+'-account-check.json'),
 JSON.stringify({platform:t.platform,account:t.account,verifiedAt:new Date().toISOString(),
 method:'webhelm-live-profile',observation:'Observed signed-in account label in live creator UI'}));
}
test('Publisher absent request skips without touching browser',async t=>{
 const f=await fixture(t);const calls=[];
 const result=await publish({input:{projectPath:f.project,runPath:f.run},runCommand:async a=>{calls.push(a);throw Error('unexpected')}});
 assert.equal(result.status,'COMPLETED');assert.equal(result.output.publicationStatus,'SKIPPED');assert.equal(calls.length,0);
});
test('Publisher rejects unbound MP4 and missing account verification before upload',async t=>{
 const f=await fixture(t);await prepare(f,[target('xhs')]);const req=JSON.parse(await readFile(join(f.run,'publisher-request.json')));
 req.videoSha256=hash('other');await writeFile(join(f.run,'publisher-request.json'),JSON.stringify(req));
 let calls=0;const runner={input:{projectPath:f.project,runPath:f.run},runCommand:async()=>{calls++;throw Error('no')}};
 await assert.rejects(publish(runner),/exact Producer MP4/);
 req.videoSha256=f.digest;await writeFile(join(f.run,'publisher-request.json'),JSON.stringify(req));
 await rm(join(f.run,'publish','xhs-account-check.json'));
 await assert.rejects(publish(runner),/ENOENT/);
 assert.equal(calls,0);
});
test('Publisher submits separately to WeChat Channels and XHS, preserving per-platform receipts',async t=>{
 const f=await fixture(t);const targets=[target('wechat-channels'),target('xhs')];await prepare(f,targets);
 const calls=[];
 const result=await publish({input:{projectPath:f.project,runPath:f.run},runCommand:async a=>{
  calls.push(a);
  if(a[0]==='webhelm'){
    const cfg=JSON.parse(await readFile(a.at(-1)));
    if(a.includes('wechat-channels')) {
      assert.equal(cfg.publish,true); assert.equal(cfg.title,targets[0].title);
      return {code:0,stdout:JSON.stringify({platform:'wechat-channels',action:'post',result:{ok:true,value:{status:'published',verified:true,post_id:'wechat-1'}}})};
    }
    assert.equal(cfg.mode,'video');assert.equal(cfg.action,'publish');
    return {code:0,stdout:JSON.stringify({platform:'xhs',action:'post',result:{ok:true,stdout:'XHS_RECEIPT '+JSON.stringify({status:'reviewing',note_id:'xhs-2'})}})};
  }
  return {code:0,stdout:JSON.stringify({status:'PASS'})};
 }});
 assert.equal(result.status,'COMPLETED');
 assert.deepEqual(result.output.results.map(x=>x.status),['published','reviewing']);
 assert.equal(result.output.results[1].verified,true);
 assert.equal(calls.filter(c=>c[0]==='webhelm').length,2);
 const first=JSON.parse(await readFile(join(f.run,'publish','wechat-channels-receipt.json')));
 assert.equal(first.identifier,'wechat-1');
});
test('Uncertain platform result fences replay and never attempts next platform',async t=>{
 const f=await fixture(t);await prepare(f,[target('wechat-channels'),target('xhs')]);
 let uploads=0;const host={input:{projectPath:f.project,runPath:f.run},runCommand:async a=>{
  if(a[0]==='webhelm'){uploads++;return {code:0,stdout:JSON.stringify({status:'unknown',verified:false})}}
  throw Error('should not validate uncertain publisher stage');
 }};
 await assert.rejects(publish(host),/uncertain platform post/);assert.equal(uploads,1);
 await assert.rejects(publish(host),/prior platform attempt/);assert.equal(uploads,1);
});
test('Producer verifies Editor exact revision, renders and probes before delivery',async t=>{
 const f=await fixture(t);await rm(f.video);await rm(join(f.run,'production-receipt.json'));
 const md='# video\nwidth:1080 height:1920 fps:30 layout:series\n';
 const checksum=hash(md);
 await writeFile(join(f.run,'video.md'),md);
 const calls=[];
 const output=await produce({input:{projectPath:f.project,runPath:f.run},runCommand:async args=>{
  calls.push(args);
  if(args[1]==='render'){await writeFile(join(f.run,'output','video.mp4'),'render with audio');return {code:0}}
  if(args[0]==='ffprobe')return {code:0,stdout:JSON.stringify({streams:[{codec_type:'video'},{codec_type:'audio'}],format:{duration:'29.5'}})};
  if(args[1]?.endsWith('validate-stage.mjs'))return {code:0,stdout:JSON.stringify({status:'PASS'})};
  return {code:0,stdout:'PASS'};
 }});
 assert.equal(output.status,'COMPLETED');
 assert.equal(calls[0][1],'verify');assert.equal(calls[1][1],'render');assert.equal(calls[2][0],'ffprobe');
 assert.equal(output.output.videoMdSha256,checksum);
 assert.equal(calls.some(c=>c.includes('preview')),false);
});
test('Producer refuses invalid Markcut verify without rendering, regardless of old Viewer state',async t=>{
 const f=await fixture(t);await rm(f.video);await rm(join(f.run,'production-receipt.json'));
 await writeFile(join(f.run,'video.md'),'# video\n');
 // An old blocked viewer record from a previous failed run is not a gate.
 await writeFile(join(f.run,'editor-viewer.json'),JSON.stringify({status:'BLOCKED',videoSha256:'old',checks:[]}));
 const commands=[];
 await assert.rejects(produce({input:{projectPath:f.project,runPath:f.run},
  runCommand:async args=>{commands.push(args);return {code:1,stderr:'Markcut verification failed'};}}),/Markcut verification failed/);
 assert.deepEqual(commands.map(c=>c[1]),['verify']);
});

test('Publisher partial success resumes second platform without reposting first',async t=>{
 const f=await fixture(t);await prepare(f,[target('wechat-channels'),target('xhs')]);
 let wechatCalls=0,xhsCalls=0;
 const host={input:{projectPath:f.project,runPath:f.run},runCommand:async args=>{
  if(args[0]==='webhelm'){
   if(args.includes('wechat-channels')){wechatCalls++;return {code:0,stdout:JSON.stringify({status:'published',verified:true,post_id:'w1'})};}
   xhsCalls++;if(xhsCalls===1)return {code:1,stderr:'XHS crashed after upload state uncertain'};
   return {code:0,stdout:JSON.stringify({status:'published',note_id:'x1'})};
  }
  return {code:0,stdout:JSON.stringify({status:'PASS'})};
 }};
 await assert.rejects(publish(host),/command failed/);
 assert.equal(wechatCalls,1);assert.equal(xhsCalls,1);
 await assert.rejects(publish(host),/ambiguous prior platform attempt/);
 assert.equal(wechatCalls,1);assert.equal(xhsCalls,1);
 const first=JSON.parse(await readFile(join(f.run,'publish','wechat-channels-receipt.json')));
 assert.equal(first.identifier,'w1');
});
test('Producer optional interactive preview sends event only on request and records pending decision',async t=>{
 const f=await fixture(t);await rm(f.video);await rm(join(f.run,'production-receipt.json'));
 const md='# video\nwidth:1080 height:1920 fps:30 layout:series\n';
 await writeFile(join(f.run,'video.md'),md);
 await writeFile(join(f.run,'preview-template.json'),JSON.stringify({type:'task.interactive_decision',source:'job/id/task/id/execution/id',data:{interactive:{jobId:'test',taskId:'t',executionId:'e',invocationId:'i'}}}));
 const calls=[];
 const result=await produce({input:{projectPath:f.project,runPath:f.run,preview:{mode:'event',eventTemplatePath:'preview-template.json'}},runCommand:async args=>{
  calls.push(args);
  if(args[1]==='render'){await writeFile(join(f.run,'output','video.mp4'),'render with audio');return {code:0}}
  if(args[0]==='ffprobe')return {code:0,stdout:JSON.stringify({streams:[{codec_type:'video'},{codec_type:'audio'}],format:{duration:'4'}})};
  if(args[0]==='neo'&&args[2]==='review')return {code:0,stdout:JSON.stringify({status:'ready',commitSha:'a'.repeat(40)})};
  if(args[1]==='preview')return {code:0,stdout:JSON.stringify({status:'review_requested',requestId:'req',commitSha:'a'.repeat(40),delivery:'event'})};
  if(args[1]?.endsWith('validate-stage.mjs'))return {code:0,stdout:JSON.stringify({status:'PASS'})};
  return {code:0,stdout:'PASS'};
 }});
 assert.equal(result.status,'COMPLETED');
 assert.equal(result.output.preview.humanDecision,'PENDING');
 assert.ok(calls.some(args=>args.includes('--delivery')&&args.includes('event')));
 const pending=JSON.parse(await readFile(join(f.run,'preview-request.json')));
 assert.equal(pending.status,'review_requested');
 assert.equal(pending.humanDecision,'PENDING');
});

test('Publisher skips an explicit private-render-test Run even when request is present',async t=>{
 const f=await fixture(t);
 await prepare(f,[target('xhs')]);
 await writeFile(join(f.run,'review-mode.json'),JSON.stringify({schemaVersion:1,mode:'private-render-test',reviewStatus:'UNREVIEWED',publicationAllowed:false}));
 const called=[];
 const result=await publish({input:{projectPath:f.project,runPath:f.run},runCommand:async args=>{called.push(args);throw Error('No browser calls allowed');}});
 assert.equal(result.status,'COMPLETED');assert.equal(result.output.publicationStatus,'SKIPPED');assert.equal(called.length,0);
});

test('Markcut injected seed is the only permitted render-time Editor source mutation',()=>{
 const before='# video\nwidth:1080 height:1920 fps:30\n';
 assert.equal(assertMarkcutAutoSeedOnly(before,before),false);
 assert.equal(assertMarkcutAutoSeedOnly(before,'# video\nseed:4020129075\nwidth:1080 height:1920 fps:30\n'),true);
 assert.throws(()=>assertMarkcutAutoSeedOnly(before,'# video\nseed:4020129075\nwidth:999\n'),/beyond/);
 assert.throws(()=>assertMarkcutAutoSeedOnly(before,'# video\nseed:bad\nwidth:1080 height:1920 fps:30\n'),/beyond/);
});

test('Producer records the actual rendered Markdown after Markcut auto-seed',async t=>{
 const f=await fixture(t);await rm(f.video);await rm(join(f.run,'production-receipt.json'));
 const original='# video\nwidth:1080 height:1920 fps:30 layout:series\n';
 await writeFile(join(f.run,'video.md'),original);
 const calls=[];
 const result=await produce({input:{projectPath:f.project,runPath:f.run},runCommand:async args=>{
  calls.push(args);
  if(args[1]==='render'){await writeFile(join(f.run,'video.md'),'# video\nseed:4020129075\nwidth:1080 height:1920 fps:30 layout:series\n');await writeFile(f.video,'render with audio');return {code:0}}
  if(args[0]==='ffprobe')return {code:0,stdout:JSON.stringify({streams:[{codec_type:'video'},{codec_type:'audio'}],format:{duration:'29.5'}})};
  if(args[1]?.endsWith('validate-stage.mjs'))return {code:0,stdout:JSON.stringify({status:'PASS'})};
  return {code:0,stdout:'PASS'};
 }});
 assert.equal(result.status,'COMPLETED');
 assert.equal(result.output.videoMdSha256,hash(await readFile(join(f.run,'video.md'),'utf8')));
 assert.equal(calls.filter(a=>a[1]==='verify').length,2);
});

test('Producer safely rebinds a completed MP4 receipt after documented Markcut auto-seed, without rerendering',async t=>{
 const f=await fixture(t);
 const before='# video\nwidth:1080 height:1920 fps:30 layout:series\n';
 const after='# video\nseed:4020129075\nwidth:1080 height:1920 fps:30 layout:series\n';
 await writeFile(join(f.run,'video.md'),after);
 await writeFile(join(f.run,'production-receipt.json'),JSON.stringify({schemaVersion:1,status:'RENDERED',
  videoMdSha256:hash(before),videoSha256:f.digest,videoPath:'output/video.mp4',durationSeconds:29.5}));
 const calls=[];
 const out=await produce({input:{projectPath:f.project,runPath:f.run},runCommand:async args=>{
  calls.push(args);
  if(args[0]==='ffprobe')return {code:0,stdout:JSON.stringify({streams:[{codec_type:'video'},{codec_type:'audio'}],format:{duration:'29.5'}})};
  if(args[1]?.endsWith('validate-stage.mjs'))return {code:0,stdout:JSON.stringify({status:'PASS'})};
  if(args[1]==='render')throw Error('must reuse verified existing MP4');
  return {code:0,stdout:'PASS'};
 }});
 const receipt=JSON.parse(await readFile(join(f.run,'production-receipt.json'),'utf8'));
 assert.equal(out.status,'COMPLETED');
 assert.equal(receipt.videoMdSha256,hash(after));
 assert.equal(receipt.videoSha256,f.digest);
 assert.equal(calls.some(x=>x[1]==='render'),false);
});

test('Producer fails closed on stale or tampered MP4 receipt',async t=>{
 const f=await fixture(t);
 const md='# video\nseed:4020129075\nwidth:1080 height:1920 fps:30 layout:series\n';
 await writeFile(join(f.run,'video.md'),md);
 await writeFile(join(f.run,'production-receipt.json'),JSON.stringify({schemaVersion:1,status:'RENDERED',
  videoMdSha256:hash(md),videoSha256:hash('not the MP4'),videoPath:'output/video.mp4',durationSeconds:29.5}));
 await assert.rejects(produce({input:{projectPath:f.project,runPath:f.run},runCommand:async args=>{
  if(args[0]==='ffprobe')return {code:0,stdout:JSON.stringify({streams:[{codec_type:'video'},{codec_type:'audio'}],format:{duration:'29.5'}})};
  if(args[1]==='render')throw Error('must never overwrite source MP4');
  return {code:0,stdout:'PASS'};
 }}),/existing rendered video bytes/);
});
