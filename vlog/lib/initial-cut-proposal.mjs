/**
 * Evidence-bound INITIAL CUT proposal for the Vlog Director/Editor.
 *
 * Run before expensive image/video visual inference: input manifests, media
 * probes and available Markcut STT WebVTT are enough for a first rough cut.
 * DeepSeek Vision receives the rough-cut context on its second pass.
 * This module never calls another inference model,
 * claims an unobserved command or writes an accepted Editor decision list.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const WAKE = /(?:\b(?:hey|hi)[\s,，-]*neo\b|嘿[\s,，]*neo\b|嘿[\s,，]*尼奥)/iu;
const EDIT_COMMANDS = [
  ['remove', /(?:删掉|删除|剪掉|不要(?:这|那)?(?:一)?段|去掉(?:这|那)?段|remove|delete|cut out)/iu],
  ['keep', /(?:保留|留下|留着|别删|不要剪掉|keep this|keep that)/iu],
  ['emphasize', /(?:强调|突出|重点|放大|特写|highlight|zoom in)/iu],
  ['preserve_original_audio', /(?:保留原声|原声(?:保留|留下)|不要配音|留(?:住)?现场声|keep (?:the )?(?:original|natural) (?:sound|audio))/iu],
  ['add_text', /(?:加(?:上)?字幕|加(?:上)?文字|写上|屏幕上写|add (?:text|caption))/iu],
  ['pace', /(?:加速|放慢|慢动作|快剪|快一点|慢一点|speed up|slow down)/iu],
  ['transition', /(?:转场|淡入|淡出|硬切|transition|fade in|fade out)/iu],
  ['reorder', /(?:放到前面|放到后面|提前|往后挪|交换顺序|move (?:this|that) (?:before|after))/iu],
];

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function timeToSeconds(value) {
  const text = String(value).trim().replace(',', '.');
  const parts = text.split(':');
  if (parts.length < 2 || parts.length > 3 || parts.some(part => !/^\d+(?:\.\d+)?$/.test(part))) return null;
  let total = 0;
  for (const part of parts) total = total * 60 + Number(part);
  return total;
}

export function parseWebVtt(text) {
  if (typeof text !== 'string') return [];
  const cues = [];
  for (const chunk of text.replace(/\r/g, '').split(/\n\s*\n/)) {
    const lines = chunk.split('\n').map(line => line.trim()).filter(Boolean);
    const index = lines.findIndex(line => /-->/.test(line));
    if (index < 0) continue;
    const [from, rawTo] = lines[index].split('-->').map(s => s.trim());
    const to = rawTo?.split(/\s+/)[0];
    const start = timeToSeconds(from);
    const end = timeToSeconds(to);
    if (start == null || end == null || end <= start) continue;
    const words = lines.slice(index + 1).join(' ').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    if (words) cues.push({ start_seconds: start, end_seconds: end, text: words });
  }
  return cues.sort((a, b) => a.start_seconds - b.start_seconds);
}

function classifiedAction(utterance) {
  // A specific sound instruction wins over generic 'keep' in '保留原声'.
  if (EDIT_COMMANDS.find(([name, pattern]) => name === 'preserve_original_audio' && pattern.test(utterance))) {
    return { action: 'preserve_original_audio', ambiguous: false };
  }
  const matches = EDIT_COMMANDS.filter(([, pattern]) => pattern.test(utterance));
  if (matches.length === 1) return { action: matches[0][0], ambiguous: false };
  return { action: 'needs_interpretation', ambiguous: true };
}

export function detectHeyNeoCommands(cues, sourceId, { wakePhrases = [] } = {}) {
  const commands = [];
  const custom = wakePhrases.filter(x => typeof x === 'string' && x.trim().length)
    .map(value => new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'iu'));
  for (let index = 0; index < cues.length; index++) {
    const cue = cues[index];
    const match = WAKE.exec(cue.text) || custom.map(x => x.exec(cue.text)).find(Boolean);
    if (!match) continue;
    let utterance = cue.text.slice(match.index + match[0].length).replace(/^[\s,，:：。.!！-]+/, '').trim();
    let end = cue.end_seconds;
    if (!utterance && cues[index + 1] && cues[index + 1].start_seconds - end <= 2.5) {
      utterance = cues[index + 1].text;
      end = cues[index + 1].end_seconds;
      index++;
    }
    const classified = classifiedAction(utterance);
    commands.push({
      id: `${sourceId}-command-${String(commands.length + 1).padStart(2, '0')}`,
      source_id: sourceId, start_seconds: cue.start_seconds, end_seconds: end,
      wake_phrase: match[0], utterance, action: classified.action,
      recognition: 'rule_based_from_stt', confidence: 'requires_audio_review',
      ambiguous: classified.ambiguous, edit_intent: utterance,
      proposed_handling: classified.ambiguous
        ? 'resolve_in_editor_before_applying'
        : 'editor_should_apply_if_source_target_verified',
      exclude_command_audio_from_story: true,
    });
  }
  return commands;
}

function sourceFile(media, manifest) {
  const root = manifest.canonical_source_directory;
  const name = media.path;
  if (typeof name !== 'string' || !name || basename(name) !== name) {
    throw new Error(`Untrusted or missing media filename: ${String(name)}`);
  }
  if (typeof media.original_path === 'string' && isAbsolute(media.original_path) && existsSync(media.original_path)) {
    return media.original_path;
  }
  if (typeof root === 'string' && isAbsolute(root)) return join(root, name);
  throw new Error(`No verified local path for ${media.id}`);
}

function checkSourceMedia(media, manifest) {
  const path = sourceFile(media, manifest);
  if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`Missing original media: ${media.id}`);
  if (!/^[0-9a-f]{64}$/i.test(media.sha256 || '')) throw new Error(`Missing valid source hash: ${media.id}`);
  const actual = createHash('sha256').update(readFileSync(path)).digest('hex');
  if (actual.toLowerCase() !== media.sha256.toLowerCase()) throw new Error(`Source hash mismatch: ${media.id}`);
  return path;
}

function visionRanges(perception, duration) {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  if (Array.isArray(perception?.observations) && perception.observations.length) {
    return perception.observations.map((item) => ({
      at_seconds: finiteNumber(item.seconds),
      start_seconds: finiteNumber(item.startSeconds),
      end_seconds: finiteNumber(item.endSeconds),
      description: item.description || '',
      evidence_id: item.id,
    })).filter(x => x.start_seconds != null && x.end_seconds > x.start_seconds && x.end_seconds <= duration + 0.04);
  }
  const segments = Object.entries(perception?.segments || {}).map(([key, item]) => {
    const match = /^(\d+)to(\d+)$/.exec(key);
    if (!match) return null;
    return {
      at_seconds: finiteNumber(item.sampleSeconds),
      start_seconds: Number(match[1]) / 1000, end_seconds: Number(match[2]) / 1000,
      description: item.vision || '', evidence_id: key,
    };
  }).filter(Boolean).filter(x => x.end_seconds > x.start_seconds && x.start_seconds < duration + 0.04);
  return segments.sort((a, b) => a.start_seconds - b.start_seconds);
}

function sourceStart(media, info) {
  const range = media.usable_time_range_seconds;
  if (Array.isArray(range) && range.length === 2 && finiteNumber(range[0]) != null && finiteNumber(range[1]) > range[0]) {
    return range;
  }
  const duration = finiteNumber(info?.duration);
  return duration != null && duration > 0 ? [0, duration] : null;
}

function probeDuration(path) {
  try {
    const seconds = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries',
      'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', path],
    { encoding: 'utf8', timeout: 15_000 }).trim());
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  } catch { return null; }
}


export function buildInitialCutProposal({
  manifest, metadata, metadataDir, context = '', wakePhrases = [],
}) {
  if (manifest?.source_use?.approved !== true) {
    throw new Error('Source-use approval is required before proposing a Vlog cut');
  }
  if (!Array.isArray(manifest.media) || !manifest.media.length) throw new Error('Manifest has no sources');
  const sources = [];
  const gaps = [];
  const allCommands = [];
  const shotCandidates = [];
  for (const media of manifest.media) {
    const path = checkSourceMedia(media, manifest);
    const info = metadata[media.id] || {};
    if (!info?.perception?.desc) gaps.push(`Visual understanding pending for ${media.id}; rough cut uses metadata/STT only`);
    const type = /\.(?:mov|mp4|m4v|mkv|webm)$/i.test(media.path) ? 'video' : 'image';
    const source = { id: media.id, path, sha256: media.sha256, type, capture_time: media.capture_time || null };
    let cues = [];
    let ranges = [];
    let commands = [];
    let sourceRange = null;
    if (type === 'video') {
      sourceRange = sourceStart(media, info);
      if (!sourceRange) {
        const duration = probeDuration(path);
        if (duration != null) sourceRange = [0, duration];
      }
      if (!sourceRange) throw new Error(`Video duration is missing for ${media.id}`);
      ranges = visionRanges(info.perception, sourceRange[1]);
      const subtitle = info.perception?.subtitle;
      if (typeof subtitle === 'string' && subtitle && basename(subtitle) === subtitle) {
        const transcriptPath = resolve(metadataDir, subtitle);
        if (existsSync(transcriptPath)) cues = parseWebVtt(readFileSync(transcriptPath, 'utf8'));
        else gaps.push(`No readable STT subtitle for ${media.id}; Hey Neo commands cannot be ruled out`);
      } else if (existsSync(resolve(metadataDir, `${media.id}.vtt`))) {
        cues = parseWebVtt(readFileSync(resolve(metadataDir, `${media.id}.vtt`), 'utf8'));
      } else gaps.push(`No STT subtitle for ${media.id}; Hey Neo commands cannot be ruled out`);
      commands = detectHeyNeoCommands(cues, media.id, { wakePhrases });
      allCommands.push(...commands);
      if (!ranges.length) gaps.push(`No time-aligned visual observations for ${media.id}; using source duration only`);
    }
    const candidateRange = type === 'video' ? [
      sourceRange[0],
      Math.min(sourceRange[1], sourceRange[0] + 5),
    ] : null;
    const directives = commands.filter(c => candidateRange &&
      c.start_seconds < candidateRange[1] && c.end_seconds > candidateRange[0]);
    shotCandidates.push({
      shot_id: `proposal-${media.id}`, source_id: media.id, source_hash: media.sha256,
      media_type: type, source_path: path,
      candidate_start_seconds: candidateRange?.[0] ?? null,
      candidate_end_seconds: candidateRange?.[1] ?? null,
      still_duration_seconds: type === 'image' ? 2.5 : null,
      visual_description: info.perception?.desc || null,
      observed_visual_ranges: ranges, transcript_cues: cues,
      hey_neo_command_ids: directives.map(c => c.id),
      speech_command_audio_exclusions: directives.map(c => ({
        start_seconds: c.start_seconds, end_seconds: c.end_seconds,
      })),
      original_audio_intent: cues.length ? 'review_spoken_audio_and_preserve_meaningful_sound'
        : 'verify_original_audio_before_muting',
      source_time_verified: !!media.capture_time,
    });
    sources.push(source);
  }

  // Apply a destructive spoken rule only when the command names one exact,
  // verified source ID/file. '这段' is not a reliable whole-clip target.
  for (const command of allCommands) {
    const targets = sources.filter(source => {
      const aliases = [source.id, basename(source.path)];
      return aliases.some(alias => new RegExp(`(^|[^\\w])${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\w])`, 'i').test(command.utterance));
    });
    command.target_source_id = targets.length === 1 ? targets[0].id : null;
    command.applied_in_rough_cut = false;
    if (command.action === 'remove' && !command.ambiguous && command.target_source_id) {
      command.applied_in_rough_cut = true;
    }
  }
  const excluded = new Set(allCommands.filter(command => command.applied_in_rough_cut).map(command => command.target_source_id));
  if (excluded.size >= shotCandidates.length) throw new Error('Hey Neo would remove all shots; require Editor review');
  for (const command of allCommands) {
    if (command.action === 'remove' && !command.target_source_id)
      gaps.push(`Hey Neo remove command at ${command.source_id}@${command.start_seconds}s has no exact target; not applied`);
  }
  // A moving source is an editorial *candidate* for a hook, not proof of an
  // exciting event. Remaining sources retain capture-time order if available.
  const sorted = shotCandidates.filter(candidate => !excluded.has(candidate.source_id)).sort((a, b) => {
    const x = sources.find(s => s.id === a.source_id)?.capture_time || '';
    const y = sources.find(s => s.id === b.source_id)?.capture_time || '';
    return x.localeCompare(y) || a.source_id.localeCompare(b.source_id);
  });
  const firstVideo = sorted.find(x => x.media_type === 'video');
  const ordered = firstVideo ? [firstVideo, ...sorted.filter(x => x !== firstVideo)] : sorted;
  const edits = ordered.map((candidate, index) => {
    const isVideo = candidate.media_type === 'video';
    return {
      shot_id: candidate.shot_id, source_id: candidate.source_id,
      source_hash: candidate.source_hash, source_path: candidate.source_path,
      in_seconds: isVideo ? candidate.candidate_start_seconds : 0,
      out_seconds: isVideo ? candidate.candidate_end_seconds : candidate.still_duration_seconds,
      beat: index === 0 ? 'hook' : index === ordered.length - 1 ? 'payoff' : 'development',
      transition: 'cut', target_duration_seconds: isVideo
        ? candidate.candidate_end_seconds - candidate.candidate_start_seconds : candidate.still_duration_seconds,
      audioIntent: candidate.original_audio_intent,
      speech_command_audio_exclusions: candidate.speech_command_audio_exclusions,
      compliance_review: candidate.hey_neo_command_ids,
      decision_status: 'proposed_unapproved',
      rationale: index === 0 && isVideo
        ? 'Provisional motion-first hook; Director must verify real appeal and payoff'
        : 'Provisional source-backed story placement; Director must verify continuity',
    };
  });
  for (const cmd of allCommands) {
    if (cmd.ambiguous) gaps.push(`Ambiguous Hey Neo command at ${cmd.source_id}@${cmd.start_seconds}s: editor must resolve`);
    else gaps.push(`Hey Neo ${cmd.action} at ${cmd.source_id}@${cmd.start_seconds}s: Editor must verify target and apply`);
  }
  return {
    schema_version: 1, stage: 'vision_preprocess', status: 'DRAFT_DIRECTOR_EDITOR_REVIEW_REQUIRED',
    purpose: 'Initial cut suggestion only; not an approved EDL, preview or publish authorization',
    context: context || null,
    inputs: { source_use: manifest.source_use.scope, source_ids: sources.map(s => s.id),
      perception: 'pending or cached Markcut ITT/VTT', speech: 'Markcut STT WebVTT if present' },
    shot_candidates: shotCandidates,
    hey_neo_commands: allCommands,
    proposed_edl: { schema_version: 1, edits },
    vision_handoff: {
      objective: 'Evaluate whether the provisional hook, sequence and source intervals serve the Vlog story; describe evidence not assumptions',
      context, current_order: edits.map(e => ({ source_id: e.source_id, beat: e.beat,
        source_in: e.in_seconds, source_out: e.out_seconds })),
      constraints: allCommands.map(c => ({ source_id: c.source_id, action: c.action,
        source_start_seconds: c.start_seconds, source_end_seconds: c.end_seconds,
        requires_review: c.confidence === 'requires_audio_review',
        target_source_id: c.target_source_id, applied_in_rough_cut: c.applied_in_rough_cut })),
      unresolved_visuals: shotCandidates.filter(s => !s.visual_description).map(s => s.source_id),
    },
    unresolved: gaps,
    editorial_rules: {
      visual_truth: 'Only observed source ranges can ground scene assertions',
      wake_phrase: 'Recognize Hey Neo in STT; treat following speech as editing instruction',
      control_audio: 'Normally exclude command speech from final audio; retain other original audio',
      gates: 'Director revises shot selection; Editor verifies exact timecodes and directives; Producer preview approval still required',
    },
  };
}

export function loadInitialCutInputs(runDir, metadataOverride) {
  const manifestPath = join(runDir, 'source-manifest.json');
  if (!existsSync(manifestPath)) throw new Error(`Missing source-manifest.json in ${runDir}`);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const metadataPath = metadataOverride || manifest.markcut_metadata_path;
  const exists = !!metadataPath && existsSync(metadataPath);
  const metadataDir = exists ? dirname(metadataPath) : manifest.canonical_source_directory;
  if (!metadataDir || !isAbsolute(metadataDir)) throw new Error('Missing canonical source directory');
  return { manifest, metadata: exists ? JSON.parse(readFileSync(metadataPath, 'utf8')) : {}, metadataDir };
}
