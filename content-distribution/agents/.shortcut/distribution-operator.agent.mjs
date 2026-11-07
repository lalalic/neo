import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {scope,jsonRun,completed,sourceCheck} from './contract.mjs';

export async function run(context) {
  const {project,run}=await scope(context);
  await sourceCheck(context,project,run);
  await jsonRun(run,'creative-plan.json');
  // A shortcut is permitted only for the explicit safe no-publication branch.
  const grant=await readFile(join(run,'campaign-authorization.json')).then(()=>true,e=>{
    if(e.code==='ENOENT')return false; throw e;
  });
  if(grant) throw Error('publication_authorization_requires_operator_worker');
  const path=join(run,'release-plan.json');
  const payload=JSON.stringify({schema:'content-distribution.release-plan.v1',
    status:'SKIPPED_PRIVATE_HOLD',publicationAllowed:false,
    reason:'No verified owner Campaign publication authorization; no external post attempted.'},null,2)+'\n';
  try { await writeFile(path,payload,{flag:'wx',mode:0o600}); }
  catch(error){if(error.code!=='EEXIST')throw error;
    if(await readFile(path,'utf8')!==payload)throw Error('release_plan_conflicting_revision');}
  const marker=await jsonRun(run,'release-plan.json');
  if(marker.data.status!=='SKIPPED_PRIVATE_HOLD'||marker.data.publicationAllowed!==false)
    throw Error('release_skipped_verification_failed');
  return completed({release_plan_path:marker.path,status:'SKIPPED_PRIVATE_HOLD',publicationAllowed:false},[marker.path]);
}
export default {run};
