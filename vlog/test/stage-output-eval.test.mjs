import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {inspectVisioner,inspectProducer,inspectPublisher,stageQualityArtifacts,redactJudgeData} from '../lib/stage-quality-inspection.mjs';
const fixture=()=>{const dir=mkdtempSync(join(tmpdir(),'vlog-eval-agent-'));
 const save=(path,data)=>{mkdirSync(join(dir,...path.split('/').slice(0,-1)),{recursive:true});writeFileSync(join(dir,path),JSON.stringify(data))};
 return {dir,save,clear:()=>rmSync(dir,{recursive:true,force:true})};};

test('Visioner output score is computed from its own source-bound evidence',()=>{
 const f=fixture();try{
  f.save('vision-evidence.json',{sources:[{source_id:'A'}],observations:[{source_id:'A',source_time_start_seconds:1,source_time_end_seconds:3}],
   creator_intent_annotations:[{source_id:'A',utterance:'嘿 Neo',status:'MODEL_OUTPUT_UNREVIEWED'}],uncertainty:['unknown sound']});
  f.save('vision-normalized-manifest.json',{sources:[{sourceId:'A'}]});
  const r=inspectVisioner(f.dir,{media:[{id:'A'},{id:'B'}]});
  assert.equal(r.stage,'visioner');assert.equal(r.status,'INSPECTED');
  assert.equal(r.metrics.creatorIntentCount,1);assert.equal(r.metrics.sourceEvidenceCount,1);
  assert.ok(r.signals.some(x=>x.code==='VISION_SOURCE_GAPS'));
 }finally{f.clear()}
});

test('Publisher with no explicit authorization is intentionally skipped, not creative PASS',()=>{
 const f=fixture();try{
  const r=inspectPublisher(f.dir);assert.equal(r.status,'SKIPPED_NO_AUTHORIZATION');
  f.save('publish/wechat-receipt.json',{status:'PUBLISHED'});
  const missing=inspectPublisher(f.dir);
  assert.equal(missing.status,'INSPECTED');
  assert.ok(missing.signals.some(x=>x.code==='PUBLISHER_NO_AUTHORIZATION'));
 }finally{f.clear()}
});

test('Producer without a real MP4 is unverified, never PASS',()=>{
 const f=fixture();try{
  f.save('production-receipt.json',{status:'RENDERED',videoPath:'output/missing.mp4',durationSeconds:35});
  const r=inspectProducer(f.dir);assert.equal(r.status,'INSPECTED');
  assert.equal(r.metrics.probeStatus,'MISSING');
  assert.ok(r.signals.some(x=>x.code==='PRODUCER_MEDIA_UNPROBED'));
 }finally{f.clear()}
});

test('Artifact judge receives only role-owned files and sanitized secrets',()=>{
 const f=fixture();try{
  f.save('publisher-request.json',{platform:'wechat',accessToken:'private-token',password:'secret',
   approval:{status:'APPROVED',oauthCode:'sensitive'}});
  f.save('production-receipt.json',{status:'RENDERED'});
  f.save('video.md',{secret:'never send video to publisher judge'});
  const artifacts=stageQualityArtifacts(f.dir,'publisher');
  assert.deepEqual(artifacts['publisher-request.json'],{platform:'wechat',accessToken:'[REDACTED]',password:'[REDACTED]',
   approval:{status:'APPROVED',oauthCode:'[REDACTED]'}});
  assert.equal(artifacts['video.md'],undefined);
  assert.equal(redactJudgeData({api_key:'secret',nested:[{refresh_token:'secret'}]}).nested[0].refresh_token,'[REDACTED]');
 }finally{f.clear()}
});
