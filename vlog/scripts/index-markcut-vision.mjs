#!/usr/bin/env node
/**
 * Mechanical source/evidence index for the Visioner. Not source interpretation.
 * Markcut metadata and source manifest are input data, not Agent instructions.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';

const hash = value => createHash('sha256').update(value).digest('hex');
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
      sample_time_seconds: isNum(value?.sampleSeconds) ? value.sampleSeconds : null,
      origin: 'markcut_metadata.perception.segments',
      observation_status: 'MODEL_OUTPUT_UNREVIEWED',
    });
  }
  return observations.sort((a,b)=>a.source_time_start_seconds-b.source_time_start_seconds);
}

export function makeMarkcutVisionIndex(manifest, metadata, sourceDir, metadataHash) {
  if (manifest?.source_use?.approved !== true || !Array.isArray(manifest.media)) {
    throw new Error('Approved source manifest required');
  }
  const sources = [];
  const observations = [];
  const seenKeys = new Set();
  const findings = [];
  for (const source of manifest.media) {
    const id = source.id, filename = source.path;
    if (!id || typeof filename !== 'string' || filename !== basename(filename)) throw new Error('Invalid source identity');
    if (seenKeys.has(id)) throw new Error('Duplicate source identity');
    seenKeys.add(id);
    const path = source.original_path || join(sourceDir,filename);
    if (!isAbsolute(path) || !existsSync(path)) throw new Error('Missing source original: ' + id);
    if (!/^[0-9a-f]{64}$/i.test(source.sha256) ||
        hash(readFileSync(path)) !== source.sha256.toLowerCase()) throw new Error('Source hash mismatch: '+id);
    const meta = metadata[id];
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
    if (type === 'video' && !segments.length) findings.push('Missing timestamped Markcut segments: '+id);
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
  }
  return {
    schema_version:1,stage:'markcut_to_visioner_evidence_index',
    status:'SOURCE_LINKED_UNREVIEWED',
    manifest_hash:hash(JSON.stringify(manifest)),
    markcut_metadata_sha256:metadataHash,
    sources,observations,findings,
    semantic_boundary:'Descriptions are machine observations, not authenticated visual facts or Director edit choices',
  };
}
export function indexFromRun(run) {
  const manifestPath=join(run,'source-manifest.json');
  if (!existsSync(manifestPath)) throw new Error('Missing source-manifest.json');
  const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
  const metadataPath=manifest.markcut_metadata_path ||
    join(manifest.canonical_source_directory,'metadata.json');
  if(!metadataPath || !isAbsolute(metadataPath) || !existsSync(metadataPath))
    throw new Error('Missing absolute Markcut metadata path');
  const metadataBytes=readFileSync(metadataPath);
  if (manifest.markcut_metadata_sha256 && hash(metadataBytes) !== manifest.markcut_metadata_sha256) {
    throw new Error('Markcut metadata changed since manifest approval');
  }
  const metadata=JSON.parse(metadataBytes.toString());
  return makeMarkcutVisionIndex(manifest,metadata,manifest.canonical_source_directory,hash(metadataBytes));
}
if (process.argv[1] && import.meta.url === new URL('file://'+process.argv[1]).href) {
  try {
    const run=resolve(process.argv[2]||'');
    if (!run.includes('/vlog/runs/') || !/\/\d{4}-\d{2}-\d{2}(?:-[^/]+)?$/.test(run))
      throw new Error('Expected dated canonical Vlog run directory');
    const index=indexFromRun(run);
    const dest=join(run,'vision-segment-index.json');
    const temp=dest+'.tmp-'+process.pid;
    writeFileSync(temp,JSON.stringify(index,null,2)+'\n');
    renameSync(temp,dest);
    process.stdout.write(JSON.stringify({status:index.status,path:dest,
      source_count:index.sources.length,observation_count:index.observations.length,
      findings:index.findings.length})+'\n');
  } catch(error) {
    process.stderr.write('Vision index error: '+error.message+'\n');
    process.exitCode=1;
  }
}
