import {scope,jsonRun,completed,sourceCheck,runSchema} from './contract.mjs';

export async function run(context) {
  const {project,run}=await scope(context);
  const source=await sourceCheck(context,project,run);
  const campaign=await jsonRun(run,'campaign.json');
  const vision=await jsonRun(run,'analysis/vision/evidence.json');
  const strategy=await jsonRun(run,'market-strategy.json');
  if((await runSchema(context,project,strategy.path,'market-strategy.schema.json')).valid!==true)
    throw Error('market_strategy_schema_invalid');
  const d=strategy.data;
  if(d.campaign_id!==campaign.data.campaign_id||d.source_sha256!==source.source_sha256||
     vision.data.source_sha256!==source.source_sha256) throw Error('strategy_wrong_original');
  const ids=new Set(vision.data.scenes.map(s=>s.id));
  if(new Set(d.variants.map(v=>v.id)).size!==d.variants.length ||
     new Set(d.variants.map(v=>v.angle)).size!==d.variants.length ||
     d.variants.some(v=>v.scene_ids.some(id=>!ids.has(id)) || !v.disclosure.trim() ||
       v.publish_state!=='HOLD'&&v.publish_state!=='ELIGIBLE_PENDING_OWNER_AUTH'))
    throw Error('strategy_variants_not_distinct_or_unfounded');
  return completed({market_strategy_path:strategy.path,variants:d.variants.length,
    publicationAllowed:false,source_sha256:source.source_sha256},[strategy.path]);
}
export default {run};
