import { createHash } from 'node:crypto';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

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
    const id = source.id, filename = source.path;
    if (typeof id !== 'string' || !id || typeof filename !== 'string' || !filename || filename !== basename(filename) || filename==='.' || filename==='..') throw new Error('Invalid source identity');
    if (seenKeys.has(id)) throw new Error('Duplicate source identity');
    seenKeys.add(id);
    const path = realpathSync(source.original_path || join(sourceDir,filename));
    const sourceRel=relative(sourceDir,path);
    if (!isAbsolute(path) || !existsSync(path) || !sourceRel || sourceRel==='..' || sourceRel.startsWith(`..${sep}`) || isAbsolute(sourceRel) || !statSync(path).isFile()) throw new Error('Missing or out-of-scope source original: ' + id);
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
    sources,
    observations,
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
 *   allowInference?: true }, runCommand(args, cwd) }
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
  const metadataCandidate = resolve(manifest.markcut_metadata_path || join(mediaDir, 'metadata.json'));
  const metadataPath = existsSync(metadataCandidate) ? await realpath(metadataCandidate) : metadataCandidate;
  const confined=(root,path)=>{const rel=relative(root,path);return rel===''||(rel!=='..'&&!rel.startsWith(`..${sep}`)&&!isAbsolute(rel));};
  if (!confined(runPath,mediaDir) || !confined(mediaDir,metadataPath)) throw new Error('Visioner source or metadata path escapes the canonical run/source directory');
  const evidencePath = join(runPath, 'vision-evidence.json');
  if (existsSync(evidencePath)) throw new Error('Refusing to overwrite existing Visioner evidence');
  if (typeof context.runCommand !== 'function') throw new Error('Visioner host must provide its owned-process command runner');

  let markcutResult = null;
  if (!existsSync(metadataPath)) {
    if (input.allowInference !== true) throw new Error('Missing Markcut metadata; inference must be enabled for this execution');
    const cli = asArgs(input.markcutCommand);
    if (!cli.length) throw new Error('Missing configured Markcut Vision CLI command');
    const help = await context.runCommand([...cli, 'vision', '--help'], vlogRoot);
    if (help?.code !== 0) throw new Error('Could not verify Markcut Vision CLI support');
    const helpText = String(help?.stdout || '');
    for (const option of ['--itt', '--vtt', '{prompt_quoted}', '{sample_interval}']) {
      if (!helpText.includes(option)) throw new Error(`Markcut Vision CLI does not advertise required template support: ${option}`);
    }
    const adapter = asArgs(input.adapterCommand);
    if (!adapter.length) throw new Error('Missing configured ITT/VTT adapter command');
    const contextPath=input.visionContextPath ? await realpath(resolve(input.visionContextPath)) : undefined;
    if (contextPath && !confined(actualRoot,contextPath)) throw new Error('Visioner context path escapes the vetted project');
    const contextText = [contextPath ? await readFile(contextPath, 'utf8') : '', input.episodeContext || ''].filter(Boolean).join('\n');
    const adapterCommand = adapter.map(shellToken).join(' ');
    const itt = `${adapterCommand} --input {input} --prompt {prompt_quoted}`;
    const vtt = `${adapterCommand} --input {input} --prompt {prompt_quoted} --sample-interval {sample_interval}`;
    markcutResult = await context.runCommand([...cli, 'vision', mediaDir, '--itt', itt, '--vtt', vtt, '--instruct', contextText], vlogRoot);
    if (markcutResult?.code !== 0) throw new Error(`Markcut Vision failed with exit code ${String(markcutResult?.code)}`);
    if (!existsSync(metadataPath)) throw new Error('Markcut Vision exited without producing metadata.json');
  }

  // The original Markcut metadata is authoritative; project its observations
  // directly to a source-verified Visioner artifact without storing an index.
  const manifestBytes=await readFile(manifestPath);
  const metadataBytes=await readFile(metadataPath);
  const metadata=JSON.parse(metadataBytes.toString('utf8'));
  const evidence=buildVisionEvidence(manifest,metadata,mediaDir,manifestBytes,metadataBytes);

  // Even when Markcut metadata is cached, the media handed to Vision
  // Understanding must be its lightweight, source-linked .normalized copy.
  // The shared Markcut Vision normalization stays the only encoding engine.
  const cli=asArgs(input.markcutCommand??['markcut']);
  if (!cli.length)throw new Error('Vision Understanding requires Markcut Vision CLI');
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
  return {
    status: 'COMPLETED',
    output: { 'vision-evidence.json': evidencePath, 'metadata.json': metadataPath, 'vision-normalized-manifest.json': normalizedManifestPath },
    artifacts: { 'vision-evidence.json': writtenEvidence, 'metadata.json': metadata, 'vision-normalized-manifest.json': normalizedManifest },
    evidence: writtenEvidence,
    markcut: markcutResult ? { invoked: true } : { invoked: false, reused: true },
  };
}

export default { run };
