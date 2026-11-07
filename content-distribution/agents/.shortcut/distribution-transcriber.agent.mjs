import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { scope, jsonRun, readRun, command, completed, sourceCheck, runSchema } from './contract.mjs';

// Never invoke transcription from a shortcut. Reuse only source-bound output
// with a verified transcript hash and provenance manifest.
export async function run(context) {
  const {project,run}=await scope(context);
  const source=await sourceCheck(context,project,run);
  if(source.ok!==true||!source.source_sha256) throw Error('verified_original_required');
  const readOptionalManifest=(name)=>readRun(run,name)
    .then((file)=>({data:JSON.parse(file.text),path:file.path}))
    .catch((error)=>{if(error?.code!=='ENOENT') throw error; return null;});
  const localManifest=await readOptionalManifest('analysis/speech/local-asr-source.json');
  const scribeManifest=await readOptionalManifest('analysis/speech/scribe-source.json');
  const fixtureManifest=await readOptionalManifest('analysis/speech/fixture-source.json');
  if([localManifest,scribeManifest,fixtureManifest].filter(Boolean).length>1)
    throw Error('local_and_scribe_provenance_conflict');
  const route=fixtureManifest ? 'fixture' : localManifest ? 'local-asr' : 'scribe';
  const manifest=fixtureManifest ?? localManifest ?? await jsonRun(run,'analysis/speech/scribe-source.json');
  const transcriptName=route==='fixture' ? 'analysis/speech/fixture-words.json' :
    route==='local-asr' ? 'analysis/speech/local-asr.json' : 'analysis/speech/scribe.json';
  const transcript=await jsonRun(run,transcriptName);
  const schemaName=route==='fixture' ? 'fixture-source.schema.json' : route==='local-asr' ? 'local-asr-source.schema.json' : 'scribe-source.schema.json';
  const provenanceSchema=await runSchema(context,project,manifest.path,schemaName);
  if(provenanceSchema.valid!==true) throw Error(`${route}_source_schema_invalid`);
  const transcriptSha=createHash('sha256').update(await readFile(transcript.path)).digest('hex');
  if(route==='fixture') {
    const policy=await jsonRun(run,'fixture-policy.json');
    const {scribeToVtt}=await import('../../scripts/speaker-vtt.mjs');
    if(source.source_kind!=='owned_test_fixture' || policy.data.mode!=='synthetic-local-e2e' ||
      policy.data.publicationAllowed!==false) throw Error('fixture_route_requires_owned_private_source');
    scribeToVtt(transcript.data,{allowUnknownSpeaker:true});
    const words=transcript.data.words?.filter(item=>item.type==='word')??[];
    if(words.length<1 || words.some(w=>w.speaker_id!=='speaker_unknown' || w.end<=w.start || w.end>source.duration_s+0.05))
      throw Error('fixture_words_invalid_or_not_unknown');
    if(manifest.data.schema!=='content-distribution.fixture-source.v1' ||
      manifest.data.source_sha256!==source.source_sha256 ||
      manifest.data.transcript_sha256!==transcriptSha ||
      manifest.data.transcript_path!==transcript.path ||
      manifest.data.word_count!==words.length ||
      manifest.data.method!=='synthetic_authored_timed_script')
      throw Error('cached_fixture_provenance_mismatch');
  } else if(route==='local-asr') {
    const {normalizeLocalAsr}=await import('../../scripts/speaker-vtt.mjs');
    const localTranscript=normalizeLocalAsr(transcript.data);
    const checks={
      schema:manifest.data.schema==='content-distribution.local-asr-source.v1',
      source_sha256:manifest.data.source_sha256===source.source_sha256,
      source_path:manifest.data.source_path===source.source_path,
      source_bytes:manifest.data.source_bytes===source.source_bytes,
      source_duration:Number.isFinite(source.duration_s)&&Math.abs(manifest.data.source_duration_s-source.duration_s)<=0.05,
      transcript_sha256:manifest.data.transcript_sha256===transcriptSha,
      transcript_bytes:manifest.data.transcript_bytes===(await stat(transcript.path)).size,
      transcript_path:manifest.data.transcript_path===transcript.path,
      word_count:manifest.data.word_count===localTranscript.words.length,
      word_timestamps:manifest.data.word_timestamps===true,
      transcript_duration:transcript.data.duration==null || (Number.isFinite(transcript.data.duration)&&Math.abs(transcript.data.duration-source.duration_s)<=0.05),
      observed_at:Number.isFinite(Date.parse(manifest.data.observed_at)),
      engine:manifest.data.transcription_engine==='mlx-whisper',
      model_id:manifest.data.model_id==='mlx-community/whisper-large-v3-turbo',
      model_version:typeof manifest.data.model_version==='string'&&/^[a-f0-9]{40,64}$/.test(manifest.data.model_version),
      speaker_attribution:manifest.data.speaker_attribution==='unknown',
    };
    const mismatches=Object.entries(checks).filter(([,ok])=>!ok).map(([key])=>key);
    if(mismatches.length) throw Error(`cached_local_asr_provenance_mismatch:${mismatches.join(',')}`);
  } else if(manifest.data.schema!=='content-distribution.scribe-source.v1'||
    manifest.data.source_sha256!==source.source_sha256||
    manifest.data.scribe_sha256!==transcriptSha||
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
    const bridgeMode=route==='fixture' ? 'from-fixture' : route==='local-asr' ? 'from-local-asr' : 'from-scribe';
    const derived=await command(context,project,[
      process.execPath,join(project,'scripts/speaker-vtt.mjs'),bridgeMode,
      '--input',transcript.path,'--output',idPath,'--boundaries',boundsPath,'--exclusive'
    ],{json:true});
    if(derived.output!==idPath||derived.boundaries!==boundsPath||!Number.isInteger(derived.cues)||derived.cues<1)
      throw Error(`${route}_export_not_verified`);
    sourceVtt=await readRun(run,'analysis/speech/speaker-id.vtt');
    boundaries=await jsonRun(run,'analysis/speech/boundaries.json');
  }
  // Recompute the canonical expected VTT/boundaries using the existing
  // bridge's public pure functions, rather than trusting stale cached outputs.
  const {scribeToVtt,localAsrToVtt,speechBoundaryEvidence,localAsrSpeechBoundaries,parseVtt}=
    await import('../../scripts/speaker-vtt.mjs');
  const expectedVtt=route==='fixture' ? scribeToVtt(transcript.data,{allowUnknownSpeaker:true}) : route==='local-asr' ? localAsrToVtt(transcript.data) : scribeToVtt(transcript.data);
  const expectedBounds=route==='local-asr' ? localAsrSpeechBoundaries(transcript.data) : speechBoundaryEvidence(transcript.data);
  if(sourceVtt.text!==expectedVtt||JSON.stringify(boundaries.data)!==JSON.stringify(expectedBounds)||
    parseVtt(sourceVtt.text).length<1) throw Error(`${route}_derived_artifacts_mismatch`);
  return completed({runPath:run,source_sha256:source.source_sha256,route,
    transcription_engine:route==='fixture' ? 'synthetic-authored-fixture' : route==='local-asr' ? 'mlx-whisper' : 'video-use-scribe',
    transcript_path:transcript.path,speaker_id_vtt_path:sourceVtt.path,
    speech_boundaries_path:boundaries.path,
    status:`derived_from_source_bound_${route}`},
  [transcript.path,manifest.path,sourceVtt.path,boundaries.path]);
}
export default {run};
