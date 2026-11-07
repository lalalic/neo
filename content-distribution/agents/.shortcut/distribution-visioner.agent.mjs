import {scope,jsonRun,sourceCheck,completed} from './contract.mjs';

export async function run(context) {
  const {run,project}=await scope(context);
  const original=await sourceCheck(context,project,run);
  const evidence=await jsonRun(run,'analysis/vision/evidence.json');
  const d=evidence.data;
  if(d.schema!=='content-distribution.source-vision.v1' || d.source_sha256!==original.source_sha256 ||
     d.external_transfer!==false || !Number.isFinite(Date.parse(d.observed_at)) ||
     !Array.isArray(d.scenes) || d.scenes.length<3 ||
     d.scenes.some(x=>typeof x.id!=='string'||typeof x.observation!=='string'||!x.observation.trim()||
       !Number.isFinite(x.start_s)||!Number.isFinite(x.end_s)||x.start_s<0||x.end_s<=x.start_s||
       x.end_s>original.duration_s+0.05)) throw Error('source_bound_offline_vision_evidence_required');
  if(original.source_kind==='owned_test_fixture') {
    if(d.method!=='synthetic_authored_scenes') throw Error('test_scenes_must_be_explicitly_authored');
  } else if(d.method!=='local_qwen3_vl' || !d.model_id || !d.model_revision || !d.local_inference_receipt_path) {
    throw Error('real_vision_requires_verifiable_local_model_receipt');
  }
  const ids=d.scenes.map(s=>s.id);
  if(new Set(ids).size!==ids.length) throw Error('duplicate_vision_scene_id');
  return completed({source_sha256:original.source_sha256,vision_path:evidence.path,scene_count:ids.length,
    method:d.method,publicationAllowed:false},[evidence.path]);
}
export default {run};
