import { join } from 'node:path';
import { scope, jsonRun, readRun, command, completed } from './contract.mjs';

// This fast path only validates *already resolved* named VTT.
// Character inference is an Agent judgment and is not replicated here.
export async function run(context) {
  const {project,run}=await scope(context);
  const campaign=await jsonRun(run,'campaign.json');
  const path=campaign.data.story_context_path;
  if(typeof path!=='string') throw Error('official_story_context_required');
  const story=await readRun(run,path);
  const source=await readRun(run,'analysis/speech/speaker-id.vtt');
  const names=await readRun(run,'analysis/speech/speaker-name.vtt');
  const result=await command(context,project,[
    process.execPath,join(project,'scripts/speaker-vtt.mjs'),'validate',
    '--source',source.path,'--resolved',names.path,'--story-context',story.path
  ],{json:true});
  if(!Number.isInteger(result.cues)||result.cues<=0||
    !result.speaker_names||typeof result.speaker_names!=='object')
    throw Error('named_vtt_validation_failed');
  return completed({runPath:run,speaker_name_vtt_path:names.path,
    story_context_path:story.path,cues:result.cues,status:'reused_validated_named_vtt'},
  [names.path,source.path,story.path]);
}
export default {run};
