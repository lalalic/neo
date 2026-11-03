import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { scope, jsonRun, readRun, command, completed, sourceCheck, runSchema } from './contract.mjs';

// Never invoke paid Video Use STT from a shortcut. Only reuse actual Scribe output
// with a source/transcript hash binding authored by the transcription Worker.
export async function run(context) {
  const {project,run}=await scope(context);
  const source=await sourceCheck(context,project,run);
  if(source.ok!==true||!source.source_sha256) throw Error('verified_original_required');
  const manifest=await jsonRun(run,'analysis/speech/scribe-source.json');
  const transcript=await jsonRun(run,'analysis/speech/scribe.json');
  const provenanceSchema=await runSchema(context,project,manifest.path,'scribe-source.schema.json');
  if(provenanceSchema.valid!==true) throw Error('scribe_source_schema_invalid');
  if(manifest.data.schema!=='content-distribution.scribe-source.v1'||
    manifest.data.source_sha256!==source.source_sha256||
    manifest.data.scribe_sha256!==createHash('sha256').update(await readFile(transcript.path)).digest('hex')||
    manifest.data.source_path!==source.source_path||
    !Number.isFinite(Date.parse(manifest.data.observed_at))||
    manifest.data.transcription_engine!=='video-use-scribe') throw Error('cached_scribe_provenance_mismatch');

  const speechDir=join(run,'analysis/speech');
  const idPath=join(speechDir,'speaker-id.vtt');
  const boundsPath=join(speechDir,'boundaries.json');
  let sourceVtt,boundaries;
  try { sourceVtt=await readRun(run,'analysis/speech/speaker-id.vtt'); }
  catch(e){if(e?.code!=='ENOENT') throw e;}
  try { boundaries=await jsonRun(run,'analysis/speech/boundaries.json'); }
  catch(e){if(e?.code!=='ENOENT') throw e;}
  // No implicit overwrite of existing revisions, even if only one output exists.
  if(Boolean(sourceVtt)!==Boolean(boundaries)) throw Error('partial_scribe_export_requires_manual_reconciliation');

  if(!sourceVtt){
    const derived=await command(context,project,[
      process.execPath,join(project,'scripts/speaker-vtt.mjs'),'from-scribe',
      '--input',transcript.path,'--output',idPath,'--boundaries',boundsPath,'--exclusive'
    ],{json:true});
    if(derived.output!==idPath||derived.boundaries!==boundsPath||!Number.isInteger(derived.cues)||derived.cues<1)
      throw Error('scribe_export_not_verified');
    sourceVtt=await readRun(run,'analysis/speech/speaker-id.vtt');
    boundaries=await jsonRun(run,'analysis/speech/boundaries.json');
  }
  // Recompute the canonical expected VTT/boundaries using the existing
  // bridge's public pure functions, rather than trusting stale cached outputs.
  const {scribeToVtt,speechBoundaryEvidence,parseVtt}=await import('../../scripts/speaker-vtt.mjs');
  const expectedVtt=scribeToVtt(transcript.data);
  const expectedBounds=speechBoundaryEvidence(transcript.data);
  if(sourceVtt.text!==expectedVtt||JSON.stringify(boundaries.data)!==JSON.stringify(expectedBounds)||
    parseVtt(sourceVtt.text).length<1) throw Error('scribe_derived_artifacts_mismatch');
  return completed({runPath:run,source_sha256:source.source_sha256,
    scribe_path:transcript.path,speaker_id_vtt_path:sourceVtt.path,
    speech_boundaries_path:boundaries.path,status:'derived_from_source_bound_scribe'},
  [transcript.path,manifest.path,sourceVtt.path,boundaries.path]);
}
export default {run};
