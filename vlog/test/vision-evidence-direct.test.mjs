import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildVisionEvidence} from '../agents/.shortcut/vlog-visioner.agent.mjs';
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
  const out=buildVisionEvidence(f.manifest,f.metadata,f.dir,
    Buffer.from(JSON.stringify(f.manifest)),Buffer.from(JSON.stringify(f.metadata)));
  assert.equal(out.status,'EVIDENCE_READY_UNREVIEWED');
  assert.equal(out.sources.length,2);
  assert.deepEqual(out.observations.map(x=>[x.evidence_id,x.source_time_start_seconds,x.source_time_end_seconds]),
    [['CLIP:0to2000',0,2],['CLIP:2000to4000',2,4]]);
  assert.equal(out.observations[0].source_sha256,hash('video bytes'));
  assert.equal(out.observations[0].status,'MODEL_OUTPUT_UNREVIEWED');
  assert.equal(out.observations[1].metadata_pointer,'/CLIP/perception/segments/2000to4000');
  assert.equal(out.sources[1].summary,'Blue sky');
  assert.equal(Object.hasOwn(out.observations[1],'agent_instructions'),false,'Do not promote unreviewed model commands into canonical evidence');
});
test('DeepSeek frame observations also bridge without pretending periodic sampling is a semantic cut',t=>{
  const f=fixture(t);
  delete f.metadata.CLIP.perception.segments;
  f.metadata.CLIP.perception.observations=[
    {seconds:1,startSeconds:0,endSeconds:2,description:'first sampled frame'},
    {seconds:3,startSeconds:2,endSeconds:4,description:'second sampled frame'},
  ];
  const out=buildVisionEvidence(f.manifest,f.metadata,f.dir,
    Buffer.from(JSON.stringify(f.manifest)),Buffer.from(JSON.stringify(f.metadata)));
  assert.equal(out.observations.length,2);
  assert.equal(out.observations[0].origin,'markcut_metadata.perception.observations');
  assert.equal(out.observations[0].source_time_end_seconds,2);
});
test('rejects invalid timecodes and missing Markcut metadata without rehashing sources',t=>{
  const f=fixture(t);
  const build=()=>buildVisionEvidence(f.manifest,f.metadata,f.dir,Buffer.from(JSON.stringify(f.manifest)),Buffer.from(JSON.stringify(f.metadata)));
  f.metadata.CLIP.perception.segments={'0to5000':{vision:'bad'}};
  assert.throws(build,/Invalid segment bounds/);
  f.metadata.CLIP.perception.segments={'0to4000':{vision:'okay'}};
  f.metadata.STILL=undefined;
  assert.throws(build,/Missing Markcut metadata/);
  f.metadata.STILL={perception:{desc:'Photo'}};
  writeFileSync(f.manifest.media[1].original_path,'altered');
  assert.doesNotThrow(build); // Source checksums are opaque provenance, not a validation gate.
});
test('direct evidence rejects source files outside the approved media directory',t=>{
  const f=fixture(t);
  const allowed=join(f.dir,'input');
  mkdirSync(allowed);
  const outside=join(f.dir,'outside.mov');
  writeFileSync(outside,'fixture');
  f.manifest.media[0].original_path=outside;
  assert.throws(()=>buildVisionEvidence(f.manifest,f.metadata,allowed,
    Buffer.from(JSON.stringify(f.manifest)),Buffer.from(JSON.stringify(f.metadata))),
    /Missing or out-of-scope source original/);
});

test('direct evidence retains manifest and metadata byte hashes, not a redundant index hash',t=>{
  const f=fixture(t);
  const manifestBytes=Buffer.from(JSON.stringify(f.manifest,null,2)+'\n');
  const metadataBytes=Buffer.from(JSON.stringify(f.metadata,null,2)+'\n');
  const result=buildVisionEvidence(f.manifest,f.metadata,f.dir,manifestBytes,metadataBytes);
  assert.equal(result.manifest_hash,hash(manifestBytes));
  assert.equal(result.markcut_metadata_sha256,hash(metadataBytes));
  assert.equal(Object.hasOwn(result,'vision_segment_index_sha256'),false);
});
