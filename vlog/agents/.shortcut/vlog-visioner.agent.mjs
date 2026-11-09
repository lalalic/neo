import { createHash } from 'node:crypto';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {reviewRequested,waitForSourceReview} from '../../lib/visioner-shortcut-review.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const neoRoot = resolve(here, '../../..');
const sha256 = value => createHash('sha256').update(value).digest('hex');

function asArgs(value) {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error('shortcut command must be an argument array');
  }
  return value;
}

function shellToken(value) {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function validRunPath(vlogRoot, runPath) {
  const actualVlogRoot=await realpath(resolve(vlogRoot));
  const root = `${await realpath(resolve(actualVlogRoot, 'runs'))}/`;
  const candidate=resolve(runPath);
  const run = await realpath(candidate);
  if (!run.startsWith(root) || !/^\d{4}-\d{2}-\d{2}(?:-[^/]+)?$/.test(run.slice(root.length))) {
    throw new Error('Visioner requires a dated canonical Vlog runs/<episode> directory');
  }
  return run;
}

const isNum = n => typeof n === 'number' && Number.isFinite(n);
function verifiedSourcePath(source, sourceDir) {
  const id=source.id, filename=source.path;
  if(typeof id!=='string'||!id||typeof filename!=='string'||!filename||filename!==basename(filename)||filename==='.'||filename==='..')
    throw new Error('Invalid source identity');
  const path=realpathSync(source.original_path||join(sourceDir,filename));
  const rel=relative(sourceDir,path);
  if (!isAbsolute(path)||!existsSync(path)||!rel||rel==='..'||rel.startsWith(`..${sep}`)||isAbsolute(rel)||!statSync(path).isFile())
    throw new Error('Missing or out-of-scope source original: '+id);
  return path;
}

function parseMarkcutSegmentRanges(perception, sourceId, limit) {
  const observations = [];
  const raw = perception?.segments || {};
  for (const [key, value] of Object.entries(raw)) {
    const match = /^(\d+)to(\d+)$/.exec(key);
    if (!match) throw new Error('Unrecognized Markcut segment key: ' + key);
    const start = Number(match[1]) / 1000;
    const end = Number(match[2]) / 1000;
    if (!isNum(start) || !isNum(end) || start < 0 || end <= start ||
        (limit != null && end > limit + 0.1)) throw new Error('Invalid segment bounds: ' + key);
    observations.push({
      evidence_id: sourceId + ':' + key,
      source_id: sourceId,
      source_time_start_seconds: start, source_time_end_seconds: end,
      visual_observation: typeof value?.vision === 'string' ? value.vision : '',
      speech_hint: typeof value?.subtitle === 'string' ? value.subtitle : null,
      semantic_description: typeof value?.description === 'string' ? value.description : null,
      sample_time_seconds: isNum(value?.sampleSeconds) ? value.sampleSeconds : null,
      origin: 'markcut_metadata.perception.segments',
      observation_status: 'MODEL_OUTPUT_UNREVIEWED',
      // Markcut has already matched a voice-controlled edit intent to this
      // semantic source segment. Preserve it as annotation DATA for Director,
      // never as an instruction the Visioner/Director may blindly execute.
      creator_intent_hints: Array.isArray(value?.instructions) ? value.instructions
        .map((x,i) => ({value:x, instruction_index:i}))
        .filter(({value:x}) => x && typeof x === 'object' &&
          (typeof x.utterance === 'string' || typeof x.intent === 'string'))
        .map(({value:x,instruction_index}) => ({
          instruction_index,
          utterance: typeof x.utterance === 'string' ? x.utterance.slice(0,2000) : null,
          intent_hint: typeof x.intent === 'string' ? x.intent.slice(0,2000) : null,
          time_seconds: isNum(x.time_seconds) ? x.time_seconds : null,
          confidence_hint: typeof x.confidence === 'string' ? x.confidence.slice(0,40) : null,
        })) : [],
    });
  }
  return observations.sort((a,b)=>a.source_time_start_seconds-b.source_time_start_seconds);
}

function projectMarkcutMetadata(manifest, metadata, sourceDir) {
  if (!Array.isArray(manifest?.media)) throw new Error('Source manifest must contain media');
  sourceDir = realpathSync(sourceDir);
  const sources = [];
  const observations = [];
  const seenKeys = new Set();
  const findings = [];
  for (const source of manifest.media) {
    const id=source.id, filename=source.path;
    if (seenKeys.has(id)) throw new Error('Duplicate source identity');
    seenKeys.add(id);
    const path=verifiedSourcePath(source,sourceDir);
    // Source identity and path are checked; checksums are carried as opaque metadata, never recomputed.
    const meta = Object.hasOwn(metadata,id) ? metadata[id] : null;
    if (!meta) throw new Error('Missing Markcut metadata: ' + id);
    const type = /\.(mp4|mov|m4v|avi|mkv|webm|wmv)$/i.test(filename) ? 'video' : 'image';
    const duration = type === 'video' ? meta.duration : null;
    if (type === 'video' && (!isNum(duration) || duration <= 0)) throw new Error('Missing Markcut video duration for '+id);
    const allowedRange = source.usable_time_range_seconds;
    const allowedStart = Array.isArray(allowedRange) && allowedRange.length===2 ? allowedRange[0] : 0;
    const allowedEnd = Array.isArray(allowedRange) && allowedRange.length===2 ? allowedRange[1] : duration;
    if (type === 'video' && (!isNum(allowedStart) || !isNum(allowedEnd) ||
        allowedStart < 0 || allowedEnd <= allowedStart || allowedEnd > duration+0.1)) {
      throw new Error('Invalid approved video range for '+id);
    }
    const desc = typeof meta.perception?.desc === 'string' ? meta.perception.desc : '';
    if (!desc.trim()) findings.push('Missing visual description: '+id);
    const segments = type === 'video' ? parseMarkcutSegmentRanges(meta.perception,id,duration)
      .filter(x => x.source_time_end_seconds > allowedStart &&
        x.source_time_start_seconds < allowedEnd).map(x => ({
          ...x, source_time_start_seconds:Math.max(allowedStart,x.source_time_start_seconds),
          source_time_end_seconds:Math.min(allowedEnd,x.source_time_end_seconds),
        })):[];
    sources.push({
      source_id:id, source_path:path, source_filename:filename, source_sha256:source.sha256,
      media_type:type, duration_seconds:duration,
      allowed_source_time_range_seconds:type==='video'?[allowedStart,allowedEnd]:null,
      visual_summary:desc,
      summary_status:'MODEL_OUTPUT_UNREVIEWED',
      markcut_subtitle_path:typeof meta.perception?.subtitle === 'string' ? meta.perception.subtitle : null,
      markcut_metadata_entry_id:id,
    });
    for (const segment of segments) observations.push({
      ...segment, source_sha256:source.sha256, source_path:path,
      metadata_pointer:'/'+id+'/perception/segments/'+segment.evidence_id.split(':').at(-1),
    });
    // DeepSeek's timestamped observations supply metadata references even when
    // no semantic segments were inferred. Never mislabel these as approved cuts.
    const modelObservations = meta.perception?.observations;
    if (type === 'video' && Array.isArray(modelObservations) && !segments.length) {
      for (const [idx, item] of modelObservations.entries()) {
        if (!isNum(item.startSeconds) || !isNum(item.endSeconds) ||
           item.startSeconds<0 || item.endSeconds<=item.startSeconds ||
           item.endSeconds>duration+0.1) throw new Error('Invalid Markcut observation time: '+id);
        if (item.endSeconds<=allowedStart || item.startSeconds>=allowedEnd) continue;
        observations.push({
          evidence_id:id+':observation:'+idx,source_id:id,source_sha256:source.sha256,
          source_path:path,source_time_start_seconds:Math.max(allowedStart,item.startSeconds),
          source_time_end_seconds:Math.min(allowedEnd,item.endSeconds),
          sample_time_seconds:isNum(item.seconds)?item.seconds:null,
          visual_observation:typeof item.description==='string'?item.description:'',
          speech_hint:null,origin:'markcut_metadata.perception.observations',
          metadata_pointer:'/'+id+'/perception/observations/'+idx,
          observation_status:'MODEL_OUTPUT_UNREVIEWED',
        });
      }
    }
    if (type === 'video' && !observations.some(item=>item.source_id===id))
      findings.push('Missing approved timestamped Markcut segments or observations: '+id);
  }
  return { sources, observations, findings };
}

/** Create the one authoritative Visioner evidence artifact from Markcut metadata.
 * All source identity/time boundaries are checked in memory; no intermediate
 * Vlog index, extra AI inference, or second metadata store is produced.
 */
export function buildVisionEvidence(manifest, metadata, sourceDir, manifestBytes, metadataBytes) {
  const projection = projectMarkcutMetadata(manifest, metadata, sourceDir);
  if (projection.findings.length) throw new Error(`Vision evidence contains unresolved gaps: ${projection.findings.join('; ')}`);
  const sources = projection.sources.map(source => ({
    source_id: source.source_id,
    source_sha256: source.source_sha256,
    media_type: source.media_type,
    summary: source.visual_summary,
    summary_status: source.summary_status,
    evidence_ref: source.markcut_metadata_entry_id,
  }));
  const observations = projection.observations.map(item => ({
    evidence_id: item.evidence_id,
    source_id: item.source_id,
    source_sha256: item.source_sha256,
    source_time_start_seconds: item.source_time_start_seconds,
    source_time_end_seconds: item.source_time_end_seconds,
    visual_observation: item.visual_observation,
    speech_hint: item.speech_hint,
    origin: item.origin,
    metadata_pointer: item.metadata_pointer,
    status: item.observation_status,
  }));
  // Expose the semantic edit-intent markers already authored by Markcut.
  // Each cue points to a real original segment and remains UNREVIEWED until
  // a human/agent listens to the actual audio. Do not treat it as a command.
  const creator_intent_annotations = projection.observations.flatMap(item =>
    (item.creator_intent_hints ?? [])
      .filter(hint => hint.time_seconds == null ||
        (hint.time_seconds >= item.source_time_start_seconds &&
         hint.time_seconds <= item.source_time_end_seconds))
      .map(hint => ({
      annotation_id: item.evidence_id + ':intent:' + hint.instruction_index,
      evidence_id: item.evidence_id,
      source_id: item.source_id,
      source_sha256: item.source_sha256,
      source_time_start_seconds: item.source_time_start_seconds,
      source_time_end_seconds: item.source_time_end_seconds,
      source_time_seconds: hint.time_seconds != null &&
        hint.time_seconds >= item.source_time_start_seconds &&
        hint.time_seconds <= item.source_time_end_seconds ? hint.time_seconds : null,
      utterance: hint.utterance,
      intent_hint: hint.intent_hint,
      confidence_hint: hint.confidence_hint,
      metadata_pointer: item.metadata_pointer + '/instructions/' + hint.instruction_index,
      origin: 'markcut_metadata.perception.segments.instructions',
      status: 'MODEL_OUTPUT_UNREVIEWED',
      note: 'Potential creator editing request. Prioritize listening to original source audio; not approved or executable.',
    })));
  const priorityIds = new Set(creator_intent_annotations.map(x => x.source_id));
  const findings = [...projection.findings];
  return {
    schema_version: 1,
    stage: 'visioner',
    status: 'EVIDENCE_READY_UNREVIEWED',
    manifest_hash: sha256(manifestBytes),
    markcut_metadata_sha256: sha256(metadataBytes),
    artifacts: { source_count: sources.length, observation_count: observations.length },
    summary: sources.filter(source => typeof source.summary === 'string' && source.summary.trim()).map(source => ({
      source_id: source.source_id,
      source_sha256: source.source_sha256,
      text: source.summary,
      status: source.summary_status,
    })),
    sources: sources.map(source => ({
      ...source,
      ...(priorityIds.has(source.source_id) ? {
        director_priority: 'review_creator_intent_first',
        creator_intent_annotation_count: creator_intent_annotations.filter(x => x.source_id === source.source_id).length,
      } : {}),
    })),
    observations,
    creator_intent_annotations,
    uncertainty: findings,
    evidence: observations.map(item => ({
      evidence_id: item.evidence_id,
      source_id: item.source_id,
      source_sha256: item.source_sha256,
      source_time_start_seconds: item.source_time_start_seconds,
      source_time_end_seconds: item.source_time_end_seconds,
      metadata_pointer: item.metadata_pointer,
    })),
    acceptance: 'Machine observations only; not Director acceptance, human approval, publication authorization, or a final cut.',
  };
}

/**
 * Context contract:
 * { input: { runPath, markcutCommand?: string[], markcutCli?: string,
 *   adapterCommand?: string[], visionContextPath?: string, episodeContext?: string,
 *   allowInference?: boolean, agentCommand?: string }, runCommand(args, cwd) }
 * runCommand is provided by the host so it can use its owned-process lifecycle.
 */
export async function run(context) {
  const input = context?.input;
  if (!input || typeof input !== 'object') throw new Error('Visioner shortcut requires structured input');
  // Relay passes the current Neo Project root, not the Neo monorepo root.
  // Support legacy fixture callers supplying a parent root explicitly.
  const projectRoot=await realpath(resolve(input.projectPath || join(neoRoot,'vlog')));
  const suppliedRoot=resolve(input.vlogRoot ||
    (basename(projectRoot)==='vlog' ? projectRoot : join(projectRoot, 'vlog')));
  const actualRoot=await realpath(suppliedRoot);
  const rootRel=relative(projectRoot,actualRoot);
  if (rootRel==='..'||rootRel.startsWith(`..${sep}`)||isAbsolute(rootRel)) throw new Error('Visioner Vlog root escapes the resolved project root');
  const vlogRoot = actualRoot;
  const taskText=typeof input.taskInput==='string' ? input.taskInput : '';
  const declaredRun=input.runPath ?? taskText.match(/^- Canonical run:\s*(\/[^\r\n]+)$/m)?.[1];
  if(typeof declaredRun!=='string'||!isAbsolute(declaredRun))throw new Error('Visioner requires an absolute canonical run path');
  const runPath = await validRunPath(vlogRoot, declaredRun);
  const manifestPath = join(runPath, 'source-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (!Array.isArray(manifest?.media) || manifest.media.length === 0) {
    throw new Error('Visioner requires a non-empty source manifest');
  }
  if (manifest.canonical_source_directory && !isAbsolute(manifest.canonical_source_directory)) throw new Error('Canonical source directory must be absolute');
  if (manifest.markcut_metadata_path && !isAbsolute(manifest.markcut_metadata_path)) throw new Error('Markcut metadata path must be absolute');
  const mediaDir = await realpath(resolve(manifest.canonical_source_directory || join(runPath, 'input/media')));
  // Validate every original path before invoking an external inference adapter.
  const ids=new Set();
  for(const source of manifest.media){
    if(ids.has(source.id))throw new Error('Duplicate source identity');
    ids.add(source.id);
    verifiedSourcePath(source,mediaDir);
  }
  const metadataCandidate = resolve(manifest.markcut_metadata_path || join(mediaDir, 'metadata.json'));
  const metadataPath = existsSync(metadataCandidate) ? await realpath(metadataCandidate) : metadataCandidate;
  const confined=(root,path)=>{const rel=relative(root,path);return rel===''||(rel!=='..'&&!rel.startsWith(`..${sep}`)&&!isAbsolute(rel));};
  if (!confined(runPath,mediaDir) || !confined(mediaDir,metadataPath)) throw new Error('Visioner source or metadata path escapes the canonical run/source directory');
  const evidencePath = join(runPath, 'vision-evidence.json');
  if (existsSync(evidencePath)) throw new Error('Refusing to overwrite existing Visioner evidence');
  if (typeof context.runCommand !== 'function') throw new Error('Visioner host must provide its owned-process command runner');

  // Watcher submissions may carry completed Markcut metadata; newly selected
  // camera-roll folders ordinarily do not. Treat metadata as a reusable cache,
  // never as a required input or an implicit permission to bypass source checks.
  const cli=asArgs(input.markcutCommand ?? ['markcut']);
  if (!cli.length) throw new Error('Vision Understanding requires a Markcut CLI');
  const manifestBytes=await readFile(manifestPath);
  let reusableMetadata=false;
  if (existsSync(metadataPath)) {
    try {
      const bytes=await readFile(metadataPath);
      buildVisionEvidence(manifest,JSON.parse(bytes.toString('utf8')),mediaDir,manifestBytes,bytes);
      reusableMetadata=true;
    } catch {
      // Extraction-only or interrupted Vision runs leave partial metadata.json.
      // The Markcut pipeline resumes incomplete perception from real originals.
    }
  }
  let markcutResult=null;
  if (!reusableMetadata) {
    if (input.allowInference === false) throw new Error('Markcut metadata is incomplete and inference was explicitly disabled');
    const command=[...cli,'vision',mediaDir];
    if (input.adapterCommand !== undefined) {
      const adapter=asArgs(input.adapterCommand);
      if (!adapter.length) throw new Error('Empty Markcut ITT/VTT adapter');
      const help=await context.runCommand([...cli,'vision','--help'],vlogRoot);
      if (help?.code!==0) throw new Error('Could not verify Markcut Vision CLI support');
      for (const option of ['--itt','--vtt','{prompt_quoted}','{sample_interval}']) {
        if (!String(help?.stdout||'').includes(option)) throw new Error('Markcut Vision CLI does not advertise required template support: '+option);
      }
      const adapterCommand=adapter.map(shellToken).join(' ');
      command.push('--itt',`${adapterCommand} --input {input} --prompt {prompt_quoted}`,
        '--vtt',`${adapterCommand} --input {input} --prompt {prompt_quoted} --sample-interval {sample_interval}`);
    }
    if (input.agentCommand !== undefined) {
      if (typeof input.agentCommand!=='string'||!input.agentCommand.trim())throw new Error('Invalid Markcut semantic Agent CLI');
      command.push('--agent',input.agentCommand);
    }
    const defaultContext=join(vlogRoot,'config','hey-neo-vision-context.md');
    const contextPath=input.visionContextPath ? await realpath(resolve(input.visionContextPath))
      : existsSync(defaultContext) ? await realpath(defaultContext) : undefined;
    if (contextPath && !confined(actualRoot,contextPath))throw new Error('Vision context path escapes project');
    const contextText=[contextPath ? await readFile(contextPath,'utf8') : '',input.episodeContext||''].filter(Boolean).join('\n');
    if (contextText)command.push('--instruct',contextText);
    markcutResult=await context.runCommand(command,vlogRoot);
    // The default Markcut semantic Agent can be absent on a fresh Neo Master.
    // Retry only that verified transport failure with the locally configured
    // Codex profile, preserving all Markcut extraction/perception ownership.
    if (markcutResult?.code!==0 && input.agentCommand===undefined &&
        /Semantic segmentation Agent returned no valid structured response/.test(String(markcutResult?.stderr||''))) {
      const fallback=`codex exec --profile zai --skip-git-repo-check --sandbox read-only --ephemeral -C ${shellToken(vlogRoot)} {prompt}`;
      markcutResult=await context.runCommand([...command,'--agent',fallback],vlogRoot);
    }
    if (markcutResult?.code!==0)throw new Error('Markcut Vision inference failed with exit code '+String(markcutResult?.code)+': '+String(markcutResult?.stderr||''));
    if (!existsSync(metadataPath))throw new Error('Markcut Vision exited without producing metadata.json');
  }

  // The original Markcut metadata is authoritative; project its observations
  // directly to a source-verified Visioner artifact without storing an index.
  const metadataBytes=await readFile(metadataPath);
  const metadata=JSON.parse(metadataBytes.toString('utf8'));
  const evidence=buildVisionEvidence(manifest,metadata,mediaDir,manifestBytes,metadataBytes);

  // Even when Markcut metadata is cached, the media handed to Vision
  // Understanding must be its lightweight, source-linked .normalized copy.
  // The shared Markcut Vision normalization stays the only encoding engine.
  const normalized=await context.runCommand([...cli,'vision',mediaDir,'--normalize-only'],vlogRoot);
  if(normalized?.code!==0)throw new Error('Markcut Vision normalization failed: '+String(normalized?.stderr||normalized?.stdout||normalized?.code));
  let payload;
  try { payload=JSON.parse(String(normalized.stdout).trim()); }
  catch { throw new Error('Markcut Vision normalization returned no valid manifest'); }
  if(payload.status!=='PASS'||payload.profile!=='markcut-vision-normalized-v1'||payload.usage!=='vision-understanding-only'||
      !Array.isArray(payload.files)||payload.files.length!==manifest.media.length)
    throw new Error('Markcut Vision normalization did not cover every source');
  const normalizedDir=await realpath(join(mediaDir,'.normalized'));
  if(!confined(mediaDir,normalizedDir))throw new Error('Vision normalization output escaped media directory');
  const mapped=[];
  const seen=new Set();
  for(const media of manifest.media){
    const actualOriginal=await realpath(join(mediaDir,media.path));
    if(!confined(mediaDir,actualOriginal) || basename(actualOriginal)!==media.path)
      throw new Error('Vision normalizer source original is out-of-scope');
    const match=payload.files.find(item=>item.source===media.path);
    if(!match || typeof match.path!=='string' || seen.has(match.path))throw new Error('Vision normalization source identity mismatch: '+media.id);
    seen.add(match.path);
    const actual=await realpath(match.path);
    const rel=relative(normalizedDir,actual);
    if(rel===''||rel==='..'||rel.startsWith(`..${sep}`)||isAbsolute(rel))throw new Error('Vision normalized output escaped .normalized directory');
    const fileStat=await stat(actual);
    if(!fileStat.isFile() || fileStat.size===0)throw new Error('Vision normalized file is empty');
    if(![360,384].includes(match.maxDimension))throw new Error('Invalid native Markcut Vision dimensions');
    mapped.push({sourceId:media.id,sourceSha256:media.sha256,originalPath:'input/media/'+media.path,
      normalizedPath:relative(runPath,actual),normalizedSha256:sha256(await readFile(actual)),
      normalizedBytes:fileStat.size,maxDimension:match.maxDimension,
      sampled:match.sampled===true,...(typeof match.sourceDurationSeconds==='number'?{originalDurationSeconds:match.sourceDurationSeconds}:{})});
  }
  const normalizedManifestPath=join(runPath,'vision-normalized-manifest.json');
  const normalizedManifest={schemaVersion:1,profile:'markcut-vision-normalized-v1',usage:'vision-understanding-only',
    sourceManifestSha256:sha256(manifestBytes),sourceTimeAuthority:'original',sourceGpsAuthority:'original-private-manifest',
    sources:mapped};
  await writeFile(normalizedManifestPath,JSON.stringify(normalizedManifest,null,2)+'\n',{flag:'wx'});
  await mkdir(dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' });
  const evidenceStat=await realpath(evidencePath);
  if (!confined(runPath,evidenceStat)) throw new Error('Vision evidence artifact escaped the canonical run');
  const writtenEvidence = JSON.parse(await readFile(evidencePath, 'utf8'));
  if(await reviewRequested(runPath)){
    // The normal Vlog Shortcut owns perception; a durable review child Task
    // uses Relay's EXISTING AWAITING_DECISION/hostInvocation lifecycle.
    // Never let Director proceed merely because a Preview was delivered.
    const accepted=await waitForSourceReview(context,runPath,input);
    const [revisedEvidence,revisedNormalized,revisedMetadata]=await Promise.all([
      readFile(evidencePath,'utf8'),readFile(normalizedManifestPath,'utf8'),readFile(metadataPath,'utf8')]);
    const checked=JSON.parse(revisedEvidence);
    return {status:'COMPLETED',output:{'vision-evidence.json':evidencePath,
      'metadata.json':metadataPath,'vision-normalized-manifest.json':normalizedManifestPath},
      artifacts:{'vision-evidence.json':checked,
        'metadata.json':JSON.parse(revisedMetadata),'vision-normalized-manifest.json':JSON.parse(revisedNormalized)},
      evidence:checked,markcut:markcutResult?{invoked:true,reused:false}:{invoked:false,reused:true},
      review:{approved:true,revision:accepted.revision,taskId:accepted.taskId}};
  }
  return {
    status: 'COMPLETED',
    output: { 'vision-evidence.json': evidencePath, 'metadata.json': metadataPath, 'vision-normalized-manifest.json': normalizedManifestPath },
    artifacts: { 'vision-evidence.json': writtenEvidence, 'metadata.json': metadata, 'vision-normalized-manifest.json': normalizedManifest },
    evidence: writtenEvidence,
    markcut: markcutResult ? { invoked: true, reused: false } : { invoked: false, reused: true },
  };
}

export default { run };
