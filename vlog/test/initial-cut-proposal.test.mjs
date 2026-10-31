import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {renderInitialCutPreview,visionContextFromProposal} from '../lib/initial-cut-preview.mjs';
import {parseWebVtt,prepareInitialCutEvidence,buildInitialCutProposal,makeInitialCutAgentPrompt} from '../lib/initial-cut-proposal.mjs';

const stt=['WEBVTT','','00:00.000 --> 00:00.940','早上走这条路。','','00:01.000 --> 00:01.300','嘿 Neo','','00:01.310 --> 00:02.100','这段原声保留','','00:02.500 --> 00:03.500','我看到了一条河。','','00:04.000 --> 00:04.500','嘿 Neo 这一段剪掉',''].join('\n');
function fixture(){
  const dir=mkdtempSync(join(tmpdir(),'vlog-agent-test-'));
  const media=[['PHOTO','PHOTO.JPG','image test'],['VIDEO','VIDEO.mp4','video test']].map(([id,name,content])=>{
    const original_path=join(dir,name);writeFileSync(original_path,content);
    return {id,path:name,original_path,sha256:createHash('sha256').update(content).digest('hex'),
      capture_time:'2026-10-30T12:00:00Z',usable_time_range_seconds:id==='VIDEO'?[0,6]:null};
  });
  writeFileSync(join(dir,'VIDEO.vtt'),stt);
  return {dir,manifest:{source_use:{approved:true,scope:'private test'},media,canonical_source_directory:dir},metadata:{},metadataDir:dir};
}
function decision(e){
  return {evidence_hash:e.evidence_hash,commands:[
    {id:'K1',source_id:'VIDEO',cue_ids:['C002','C003'],instruction:'保留这段原声',
      action:'preserve_original_audio',target_source_id:'VIDEO',rationale:'Two cues form one spoken command',
      confidence:'high',exclude_command_audio:true},
    {id:'K2',source_id:'VIDEO',cue_ids:['C005'],instruction:'剪掉该段',
      action:'remove',target_source_id:null,rationale:'Referent uncertain',
      confidence:'low',exclude_command_audio:true}
  ],edits:[
    {shot_id:'s1',source_id:'VIDEO',in_seconds:0,out_seconds:2.2,beat:'hook',
      reason:'Spoken opening setup',audio_intent:'original'},
    {shot_id:'s2',source_id:'VIDEO',in_seconds:2.2,out_seconds:3.9,beat:'development',
      reason:'Speech shifts toward stream discovery',audio_intent:'original'},
    {shot_id:'s3',source_id:'PHOTO',in_seconds:0,out_seconds:2.5,beat:'payoff',
      reason:'Provisional still after speech',audio_intent:'silent'}
  ],uncertainties:['No visual evidence yet']};
}
test('raw STT parsing with exact cue times; no keyword recognition',()=>{
  const cues=parseWebVtt(stt);assert.equal(cues.length,5);
  assert.deepEqual([cues[1].start_seconds,cues[1].end_seconds,cues[1].text],[1,1.3,'嘿 Neo']);
});
test('preprocess produces grounded input and an Agent semantic splitting prompt',t=>{
  const f=fixture();t.after(()=>rmSync(f.dir,{recursive:true,force:true}));
  const e=prepareInitialCutEvidence(f);
  assert.equal(e.status,'AWAITING_AGENT_SEMANTIC_DECISION');
  assert.equal(e.sources[1].duration_seconds,6);
  assert.equal(e.sources[1].transcript_cues[2].text,'这段原声保留');
  const prompt=makeInitialCutAgentPrompt(e);
  assert.match(prompt,/semantic/);assert.match(prompt,/multiple distinct shots/);assert.match(prompt,/嘿 Neo/);
});
test('Agent semantically chooses two distinct shots from SAME original clip',t=>{
  const f=fixture();t.after(()=>rmSync(f.dir,{recursive:true,force:true}));
  const evidence=prepareInitialCutEvidence(f);
  const p=buildInitialCutProposal({evidence,agentDecision:decision(evidence)});
  assert.equal(p.status,'DRAFT_DIRECTOR_EDITOR_REVIEW_REQUIRED');
  assert.deepEqual(p.proposed_edl.edits.map(x=>x.source_id),['VIDEO','VIDEO','PHOTO']);
  assert.deepEqual(p.proposed_edl.edits.map(x=>x.in_seconds),[0,2.2,0]);
  assert.deepEqual(p.proposed_edl.edits[0].speech_command_audio_exclusions,[{start_seconds:1,end_seconds:2.1}]);
  assert.equal(p.hey_neo_commands[0].recognized_by,'visioner_agent_semantic_interpretation');
  assert.equal(JSON.parse(visionContextFromProposal(p)).rough_cut_order.length,3);
});
test('stale hash, fabricated cue, unknown source and out-of-range cuts all fail closed',t=>{
  const f=fixture();t.after(()=>rmSync(f.dir,{recursive:true,force:true}));
  const e=prepareInitialCutEvidence(f), d=decision(e);
  const check=x=>buildInitialCutProposal({evidence:e,agentDecision:x});
  assert.throws(()=>check({...d,evidence_hash:'bad'}),/stale/);
  assert.throws(()=>check({...d,commands:[{...d.commands[0],cue_ids:['C888']}]}),/nonexistent/);
  assert.throws(()=>check({...d,edits:[{...d.edits[0],source_id:'unknown'}]}),/Unknown source/);
  assert.throws(()=>check({...d,edits:[{...d.edits[0],out_seconds:99}]}),/outside original/);
});
test('no STT yields uncertainty, never invented cue recognition',t=>{
  const f=fixture();t.after(()=>rmSync(f.dir,{recursive:true,force:true}));
  rmSync(join(f.dir,'VIDEO.vtt'));
  const e=prepareInitialCutEvidence(f);
  assert.equal(e.sources[1].transcript_cues.length,0);
  assert.ok(e.unresolved.some(x=>x.includes('Speech-to-text missing')));
  assert.throws(()=>buildInitialCutProposal({evidence:e,agentDecision:decision(e)}),/nonexistent/);
});
test('only approved intact sources can enter Agent planning',t=>{
  const f=fixture();t.after(()=>rmSync(f.dir,{recursive:true,force:true}));
  f.manifest.source_use.approved=false;
  assert.throws(()=>prepareInitialCutEvidence(f),/approval/);
  f.manifest.source_use.approved=true;
  writeFileSync(f.manifest.media[0].original_path,'tamper');
  assert.throws(()=>prepareInitialCutEvidence(f),/hash mismatch/);
});
test('CLI requires explicit Agent interpretation before writing draft cuts',t=>{
  const f=fixture();t.after(()=>rmSync(f.dir,{recursive:true,force:true}));
  const home=mkdtempSync(join(tmpdir(),'vlog-cli-'));
  t.after(()=>rmSync(home,{recursive:true,force:true}));
  const run=join(home,'vlog','runs','2026-10-31-test');mkdirSync(run,{recursive:true});
  writeFileSync(join(run,'source-manifest.json'),JSON.stringify(f.manifest));
  const cli=join(import.meta.dirname,'../scripts/propose-initial-cut.mjs');
  const first=JSON.parse(execFileSync(process.execPath,[cli,run],{encoding:'utf8'}));
  assert.equal(first.status,'AWAITING_AGENT_SEMANTIC_DECISION');
  assert.ok(readFileSync(first.agent_prompt,'utf8').includes('嘿 Neo'));
  assert.throws(()=>execFileSync(process.execPath,[cli,run,'--preview'],{stdio:'pipe'}),/--preview requires/);
  const evidence=JSON.parse(readFileSync(first.evidence,'utf8'));
  const resultPath=join(run,'agent-decision.json');writeFileSync(resultPath,JSON.stringify(decision(evidence)));
  const second=JSON.parse(execFileSync(process.execPath,[cli,run,'--agent-result',resultPath],{encoding:'utf8'}));
  assert.equal(second.shots,3);assert.equal(second.commands,2);
  assert.equal(JSON.parse(readFileSync(second.vision_context)).rough_cut_order.length,3);
});
test('Agent-split preview is decodable and mutes only cited speech intervals',t=>{
  const dir=mkdtempSync(join(tmpdir(),'vlog-preview-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const input=join(dir,'clip.mp4'),output=join(dir,'preview.mp4');
  execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','lavfi',
    '-i','testsrc=size=160x90:rate=24:duration=3','-f','lavfi',
    '-i','sine=frequency=880:sample_rate=44100:duration=3',
    '-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',input]);
  const p={status:'DRAFT_DIRECTOR_EDITOR_REVIEW_REQUIRED',proposed_edl:{edits:[
    {source_id:'a',source_path:input,in_seconds:0.2,out_seconds:1.8,
      speech_command_audio_exclusions:[{start_seconds:0.5,end_seconds:1.0}]},
    {source_id:'b',source_path:input,in_seconds:2.1,out_seconds:2.8,
      speech_command_audio_exclusions:[]}
  ]}};
  assert.equal(renderInitialCutPreview(p,output).shots,2);
  const info=JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries',
    'stream=codec_name:format=duration','-of','json',output],{encoding:'utf8'}));
  assert.deepEqual(info.streams.map(x=>x.codec_name),['h264','aac']);
  assert.ok(Number(info.format.duration)>2.2 && Number(info.format.duration)<2.4);
  const sound=sec=>{const b=execFileSync('ffmpeg',['-v','error','-ss',String(sec),
    '-i',output,'-t','0.1','-vn','-ac','1','-ar','44100','-f','s16le','pipe:1']);
    let total=0;for(let i=0;i<b.length-1;i+=2)total+=Math.abs(b.readInt16LE(i));return total/(b.length/2);};
  assert.ok(sound(0.1)>500);assert.ok(sound(0.5)<60);
});
test('context changes invalidate Agent decisions and approved clip trim is enforced',t=>{
  const f=fixture();t.after(()=>rmSync(f.dir,{recursive:true,force:true}));
  const e=prepareInitialCutEvidence({...f,context:'ride'});
  const changed=prepareInitialCutEvidence({...f,context:'a different story'});
  assert.notEqual(e.evidence_hash,changed.evidence_hash);
  assert.throws(()=>buildInitialCutProposal({evidence:changed,agentDecision:decision(e)}),/stale/);
  f.manifest.media.find(x=>x.id==='VIDEO').usable_time_range_seconds=[1,6];
  const restricted=prepareInitialCutEvidence(f);
  assert.equal(restricted.sources.find(x=>x.id==='VIDEO').allowed_source_start_seconds,1);
  assert.throws(()=>buildInitialCutProposal({evidence:restricted,agentDecision:decision(restricted)}),/before approved/);
});
