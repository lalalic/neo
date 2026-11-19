import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {transcribeFile,toVtt,validateScribe} from '../skills/elevenlabs-stt/scripts/scribe.mjs';

const doc={language_code:'zh',text:'观众是衣食父母，Hello world!',words:[
 {type:'word',text:'观众',start:0,end:0.35,speaker_id:'speaker_0'},
 {type:'word',text:'是',start:0.36,end:0.6,speaker_id:'speaker_0'},
 {type:'word',text:'衣食父母，',start:0.65,end:1.3,speaker_id:'speaker_0'},
 {type:'audio_event',text:'(applause)',start:1.5,end:2.1},
 {type:'word',text:'Hello',start:2.4,end:2.8,speaker_id:'speaker_1'},
 {type:'word',text:'world!',start:2.85,end:3.1,speaker_id:'speaker_1'}
]};
function fixture(t){const dir=mkdtempSync(join(tmpdir(),'cd-eleven-stt-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const file=join(dir,'sample_audio.mp3'),out=join(dir,'private');writeFileSync(file,Buffer.from('authorized fake audio bytes'));
 return {dir,file,out};}

test('Scribe word-level timestamps, Chinese word boundaries, speaker labels and audio event are distinct',()=>{
 assert.equal(validateScribe(doc),5);
 const vtt=toVtt(doc);
 assert.match(vtt,/WEBVTT/);assert.match(vtt,/00:00:00\.000 --> 00:00:01\.300\n<v speaker_0>观众是衣食父母，<\/v>/);
 assert.match(vtt,/00:00:02\.400 --> 00:00:03\.100\n<v speaker_1>Hello world!<\/v>/);
 assert.doesNotMatch(vtt,/applause/);
 assert.equal((vtt.match(/-->/g)||[]).length,2);
});
test('malformed Scribe timestamps or speaker labels fail closed',()=>{
 assert.throws(()=>validateScribe({words:[{type:'word',text:'A',start:1,end:0.1}]}),/invalid/);
 assert.throws(()=>validateScribe({words:[{type:'word',text:'A',start:0,end:1,speaker_id:'Alice'}]}),/speaker_invalid/);
 assert.throws(()=>validateScribe({text:'hello'}),/words_required/);
});
test('no cloud transfer without explicit authorization and key',async t=>{
 const f=fixture(t);let calls=0;
 const fake=async()=>{calls++;return {ok:true,json:async()=>doc};};
 await assert.rejects(transcribeFile({input:f.file,outputDir:f.out,apiKey:'test',fetchImpl:fake}),/explicit_source_authorization/);
 await assert.rejects(transcribeFile({input:f.file,outputDir:f.out,confirmCloudUpload:true,apiKey:'',fetchImpl:fake}),/API_KEY_missing/);
 assert.equal(calls,0);assert.equal(existsSync(join(f.out,'sample_audio.scribe.json')),false);
});
test('API mock creates private evidence, expected Markcut VTT name, and idempotent cache',async t=>{
 const f=fixture(t),calls=[];
 const fake=async (url,options)=>{
  calls.push({url,options});
  assert.equal(options.method,'POST');
  assert.equal(options.headers['xi-api-key'],'test-token');
  assert.equal(options.body.get('model_id'),'scribe_v3');
  assert.equal(options.body.get('diarize'),'true');
  assert.equal(options.body.get('timestamps_granularity'),'word');
  assert.equal(options.body.get('file').name,'sample_audio.mp3');
  return {ok:true,json:async()=>doc};
 };
 const run=()=>transcribeFile({input:f.file,outputDir:f.out,confirmCloudUpload:true,apiKey:'test-token',fetchImpl:fake,now:()=>new Date('2026-11-19T20:00:00Z')});
 const a=await run();assert.equal(a.cached,false);assert.equal(a.word_count,5);
 assert.equal(calls.length,1);assert.equal(a.vtt_path,join(f.out,'sample_audio.vtt'));
 const transcript=JSON.parse(readFileSync(join(f.out,'sample_audio.scribe.json'),'utf8'));
 assert.deepEqual(transcript,doc);
 const source=JSON.parse(readFileSync(join(f.out,'sample_audio.scribe-source.json'),'utf8'));
 assert.equal(source.transcription_engine,'elevenlabs-scribe');assert.equal(source.model_id,'scribe_v3');
 assert.match(source.input_sha256,/^[a-f0-9]{64}$/);assert.match(source.transcript_sha256,/^[a-f0-9]{64}$/);
 assert.equal(statSync(a.vtt_path).mode & 0o777,0o600);
 assert.equal(statSync(join(f.out,'sample_audio.scribe.json')).mode & 0o777,0o600);
 assert.match(readFileSync(a.vtt_path,'utf8'),/观众是衣食父母/);
 const b=await run();assert.equal(b.cached,true);assert.equal(calls.length,1,'no duplicate paid upload');
 writeFileSync(f.file,Buffer.from('different authorized media'));
 await assert.rejects(run(),/cache_source_or_hash_mismatch/);
 assert.equal(calls.length,1);
});
test('partial paid transcript receipt blocks duplicate cloud request',async t=>{
 const f=fixture(t);let calls=0;
 mkdirSync(f.out,{recursive:true});
 writeFileSync(join(f.out,'sample_audio.scribe.json'),JSON.stringify(doc));
 await assert.rejects(transcribeFile({input:f.file,outputDir:f.out,confirmCloudUpload:true,apiKey:'test',fetchImpl:async()=>{calls++;return {ok:true,json:async()=>doc};}}),/cache_incomplete_no_retry/);
 assert.equal(calls,0);
});
test('unsupported files cannot be sent to cloud by the optional STT adapter',async t=>{
 const f=fixture(t);const unknown=join(f.dir,'private-secrets.txt');writeFileSync(unknown,'not audio');let calls=0;
 await assert.rejects(transcribeFile({input:unknown,outputDir:f.out,confirmCloudUpload:true,apiKey:'test',fetchImpl:async()=>{calls++;return {};}}),/unsupported_stt_input_format/);
 assert.equal(calls,0);
});
test('unknown HTTP billing status is not automatically retried',async t=>{
 const f=fixture(t);let calls=0;
 await assert.rejects(transcribeFile({input:f.file,outputDir:f.out,confirmCloudUpload:true,apiKey:'test',fetchImpl:async()=>{calls++;throw Error('network');}}),/unknown_billing_status/);
 assert.equal(calls,1);
});
test('Neo shared Visioner offers Scribe only as an opt-in Markcut --stt adapter',async()=>{
 const root=new URL('../',import.meta.url);
 const {readFile}=await import('node:fs/promises');
 const visioner=await readFile(new URL('agents/visioner.agent.md',root),'utf8');
 const skill=await readFile(new URL('skills/elevenlabs-stt/SKILL.md',root),'utf8');
 assert.match(visioner,/markcut vision/);
 assert.match(visioner,/--stt/);
 assert.match(visioner,/elevenlabs-stt/);
 assert.match(skill,/scribe_v3/);
 assert.match(skill,/--confirm-cloud-upload/);

});
