import { scope, jsonRun, readRun, command, completed, sourceCheck, runSchema } from './contract.mjs';

export async function run(context) {
  const {project,run}=await scope(context);
  const campaign=await jsonRun(run,'campaign.json');
  const source=await sourceCheck(context,project,run);
  if(source.ok!==true||typeof source.source_sha256!=='string') throw Error('verified_original_required');
  const schema=await runSchema(context,project,campaign.path,'campaign-plan.schema.json');
  if(schema.valid!==true) throw Error('campaign_manifest_schema_invalid');
  const manifest=campaign.data;
  if(typeof manifest.rights_evidence_path!=='string') throw Error('rights_evidence_required');
  const rights=await readRun(run,manifest.rights_evidence_path);
  const original=await jsonRun(run,manifest.original_source_path);
  // A shortcut cannot create rights or acquire media. It reuses previously obtained,
  // source-verified artifacts and never infers new permission from an arbitrary URL.
  if(manifest.story_context_path===undefined) throw Error('official_story_context_not_yet_acquired');
  const story=await jsonRun(run,manifest.story_context_path);
  await command(context,project,[process.execPath,
    `${project}/scripts/check-story-context.mjs`,story.path]);
  return completed({
    runPath:run,campaign_manifest_path:campaign.path,original_source_path:original.path,
    story_context_path:story.path,rights_evidence_path:rights.path,
    source_sha256:source.source_sha256,source_path:source.source_path,
    status:'reused_original_and_recorded_rights_evidence'
  },[campaign.path,original.path,source.source_path,story.path,rights.path]);
}
export default {run};
