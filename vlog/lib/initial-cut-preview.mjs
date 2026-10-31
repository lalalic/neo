/**
 * Lightweight watchable proxy of an unapproved source-linked initial cut.
 * Markcut remains the canonical final renderer. The proxy is never publishable.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const WIDTH = 540;
const HEIGHT = 960;
const RATE = 24;
const VIDEO_FILTER = `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease,pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${RATE},format=yuv420p`;

function ffmpeg(args) {
  try {
    execFileSync('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', ...args],
      { timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    throw new Error(`Initial-cut preview encoding failed: ${String(error.stderr || error.message).slice(0,800)}`, { cause: error });
  }
}

function hasAudio(file) {
  try {
    return !!execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a',
      '-show_entries', 'stream=index', '-of', 'csv=p=0', file],
    { encoding: 'utf8', timeout: 15_000 }).trim();
  } catch { return false; }
}

const clamped = (number, min, max) => Math.max(min, Math.min(max, number));

export function renderInitialCutPreview(proposal, output) {
  if (proposal?.status !== 'DRAFT_DIRECTOR_EDITOR_REVIEW_REQUIRED') {
    throw new Error('Can only render a provisional initial-cut proposal');
  }
  const edits = proposal.proposed_edl?.edits;
  if (!Array.isArray(edits) || !edits.length) throw new Error('No provisional edits to render');
  const directory = mkdtempSync(join(tmpdir(), 'vlog-initial-cut-'));
  const pieces = [];
  try {
    for (const [index, edit] of edits.entries()) {
      const duration = edit.out_seconds - edit.in_seconds;
      if (!Number.isFinite(duration) || duration <= 0 || duration > 900) {
        throw new Error(`Invalid clip duration for ${edit.source_id}`);
      }
      const isImage = /\.(jpe?g|png|webp|bmp|avif)$/i.test(edit.source_path);
      const audio = !isImage && hasAudio(edit.source_path);
      const segment = join(directory, `part-${String(index).padStart(4,'0')}.mp4`);
      const args = [];
      if (isImage) args.push('-loop','1','-framerate',String(RATE),'-i',edit.source_path);
      else args.push('-ss',String(edit.in_seconds),'-i',edit.source_path);
      if (!audio) args.push('-f','lavfi','-i','anullsrc=channel_layout=stereo:sample_rate=44100');
      args.push('-t',String(duration),'-map','0:v:0','-map',audio ? '0:a:0' : '1:a:0',
        '-vf', VIDEO_FILTER);
      const mute = (edit.speech_command_audio_exclusions || []).map(interval => {
        const start = clamped(interval.start_seconds - edit.in_seconds, 0, duration);
        const end = clamped(interval.end_seconds - edit.in_seconds, 0, duration);
        return end > start ? `between(t,${start.toFixed(3)},${end.toFixed(3)})` : null;
      }).filter(Boolean);
      if (mute.length && audio) {
        args.push('-af', `volume=0:enable='${mute.join('+')}'`);
      }
      args.push('-c:v','libx264','-preset','ultrafast','-crf','29','-r',String(RATE),
        '-c:a','aac','-b:a','96k','-ar','44100','-ac','2',
        '-shortest', '-movflags','+faststart', segment);
      ffmpeg(args);
      pieces.push(segment);
    }
    const concat = join(directory,'concat.txt');
    writeFileSync(concat, pieces.map(file => `file '${file.replace(/'/g, "'\\''")}'`).join('\n')+'\n');
    ffmpeg(['-f','concat','-safe','0','-i',concat,'-c','copy','-movflags','+faststart',output]);
    return { output, duration_seconds: edits.reduce((n,e) => n + e.out_seconds - e.in_seconds, 0),
      shots: pieces.length, format: `${WIDTH}x${HEIGHT} H264/AAC`, preview_only: true };
  } finally {
    rmSync(directory,{ recursive:true, force:true });
  }
}

export function visionContextFromProposal(proposal) {
  const context = {
    stage: 'post_initial_cut_vision_understanding',
    purpose: 'Assess and improve an unapproved Vlog rough cut using visible evidence',
    story_context: proposal.context,
    rough_cut_status: proposal.status,
    rough_cut_order: proposal.vision_handoff.current_order,
    source_timeline_map: proposal.proposed_edl.edits.map(edit => ({
      source_id: edit.source_id,
      source_hash: edit.source_hash,
      source_start_seconds: edit.in_seconds,
      source_end_seconds: edit.out_seconds,
      rough_cut_beat: edit.beat,
    })),
    hey_neo_constraints: proposal.vision_handoff.constraints,
    unresolved_visuals: proposal.vision_handoff.unresolved_visuals,
    rules: [
      'Describe only what frames show; keep story context separate from observable evidence.',
      'Evaluate hook/scene relevance and suggest better in/out times where visible evidence supports them.',
      'Do not claim audio or a spoken command exists from visual-only frames.',
      'Keep every visual observation mapped to original source time, not proxy timeline time.',
      'Do not override source-linked Hey Neo editing instructions; flag uncertainty for Editor.',
    ],
  };
  return JSON.stringify(context, null, 2) + '\n';
}
