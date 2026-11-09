import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {scope,jsonRun,completed} from './contract.mjs';

export async function run(context) {
  const {run}=await scope(context);
  const release=await jsonRun(run,'release-plan.json');
  if(release.data.status!=='SKIPPED_PRIVATE_HOLD'||release.data.publicationAllowed!==false)
    throw Error('published_analytics_require_observed_platform_receipts');
  const path=join(run,'analysis.json');
  const payload=JSON.stringify({schema:'content-distribution.analysis.v1',status:'NOT_RUN',
    reason:'No public post or provider attribution receipts.',
    impressions:null,clicks:null,qualified_purchases:null,commission:null,payout:null},null,2)+'\n';
  try{await writeFile(path,payload,{flag:'wx',mode:0o600});}
  catch(error){if(error.code!=='EEXIST')throw error;
    if(await readFile(path,'utf8')!==payload)throw Error('analytics_conflicting_revision');}
  const record=await jsonRun(run,'analysis.json');
  if(record.data.status!=='NOT_RUN')throw Error('analyst_skip_state_invalid');
  return completed({analysis_path:record.path,status:'NOT_RUN',revenueObserved:false},[record.path]);
}
export default {run};
