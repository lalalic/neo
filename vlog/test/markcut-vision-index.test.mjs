import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {makeMarkcutVisionIndex,indexFromRun} from '../scripts/index-markcut-vision.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');
function fixture(t) {
  const dir=mkdtempSync(join(tmpdir(),'vlog-markcut-evidence-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const sourceVideo=join(dir,'CLIP.mp4');
  const sourceImage=join(dir,'STILL.JPG');
  writeFileSync(sourceVideo,'video bytes');
  writeFileSync(sourceImage,'still bytes');
  const media=[
    {id:'CLIP',path:'CLIP.mp4',original_path:sourceVideo,sha256:hash('video bytes')},
    {id:'STILL',path:'STILL.JPG',original_path:sourceImage,sha256:hash('still bytes')},
  ];
  return {
    manifest:{source_use:{approved:true,scope:'private test'},media,canonical_source_directory:dir},
    metadata:{
      CLIP:{duration:4,perception:{desc:'A model-described pathway',subtitle:'CLIP.vtt',
        segments:{'0to2000':{vision:'trees',subtitle:'start'},
          '2000to4000':{vision:'path',sampleSeconds:3.5,
            instructions:[{utterance:'嘿 Neo 保留',intent:'keep this',time_seconds:3,confidence:'high'}]}}}},
      STILL:{perception:{desc:'Blue sky'}}
    },dir
  };
}
test('Markcut legacy segmentation keeps stable original-source ID/hash and time',t=>{
  const f=fixture(t);
  const out=makeMarkcutVisionIndex(f.manifest,f.metadata,f.dir,'meta-hash');
  assert.equal(out.status,'SOURCE_LINKED_UNREVIEWED');
  assert.equal(out.sources.length,2);
  assert.deepEqual(out.observations.map(x=>[x.evidence_id,x.source_time_start_seconds,x.source_time_end_seconds]),
    [['CLIP:0to2000',0,2],['CLIP:2000to4000',2,4]]);
  assert.equal(out.observations[0].source_sha256,hash('video bytes'));
  assert.equal(out.observations[0].observation_status,'MODEL_OUTPUT_UNREVIEWED');
  assert.equal(out.observations[1].metadata_pointer,'/CLIP/perception/segments/2000to4000');
  assert.equal(out.sources[1].visual_summary,'Blue sky');
  assert.equal(out.observations[1].agent_instructions[0].intent,'keep this');
  assert.equal(out.observations[1].agent_instructions[0].status,'AGENT_INTERPRETATION_UNREVIEWED');
});
test('DeepSeek frame observations also bridge without pretending periodic sampling is a semantic cut',t=>{
  const f=fixture(t);
  delete f.metadata.CLIP.perception.segments;
  f.metadata.CLIP.perception.observations=[
    {seconds:1,startSeconds:0,endSeconds:2,description:'first sampled frame'},
    {seconds:3,startSeconds:2,endSeconds:4,description:'second sampled frame'},
  ];
  const out=makeMarkcutVisionIndex(f.manifest,f.metadata,f.dir,'meta-hash');
  assert.equal(out.observations.length,2);
  assert.equal(out.observations[0].origin,'markcut_metadata.perception.observations');
  assert.equal(out.observations[0].source_time_end_seconds,2);
});
test('rejects tampered original, invalid timestamps, unapproved source and missing Markcut metadata',t=>{
  const f=fixture(t);
  const index=()=>makeMarkcutVisionIndex(f.manifest,f.metadata,f.dir,'meta-hash');
  f.manifest.source_use.approved=false;
  assert.throws(index,/Approved source/);
  f.manifest.source_use.approved=true;
  f.metadata.CLIP.perception.segments={'0to5000':{vision:'bad'}};
  assert.throws(index,/Invalid segment bounds/);
  f.metadata.CLIP.perception.segments={'0to4000':{vision:'okay'}};
  f.metadata.STILL=undefined;
  assert.throws(index,/Missing Markcut metadata/);
  f.metadata.STILL={perception:{desc:'Photo'}};
  writeFileSync(f.manifest.media[1].original_path,'altered');
  assert.throws(index,/Source hash mismatch/);
});
test('real historical Markcut metadata indexes original images/video and never claims review',()=>{
  const run='/Users/chengli/Workspace/neo/vlog/runs/2026-10-30-job536-real-review-e2e';
  const out=indexFromRun(run);
  assert.equal(out.sources.length,3);
  assert.equal(out.observations.length,2);
  assert.deepEqual(out.observations.map(x=>[x.source_time_start_seconds,x.source_time_end_seconds]),
    [[0,0.94],[0.94,1.5667]]);
  assert.ok(out.observations.every(x=>x.observation_status==='MODEL_OUTPUT_UNREVIEWED'));
});
