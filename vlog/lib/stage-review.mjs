import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, mkdirSync, writeFileSync, appendFileSync,
  statSync, openSync, readSync, closeSync } from 'node:fs';
import { resolve, join, dirname, relative, isAbsolute } from 'node:path';

export const STAGE_FILES = Object.freeze({
  visioner: ['source-manifest.json', 'vision-evidence.json'],
  director: ['source-manifest.json', 'vision-evidence.json', 'shot-selection.json', 'story.md', 'visual-brief.md'],
  editor: ['source-manifest.json', 'vision-evidence.json', 'shot-selection.json', 'story.md', 'edit-decision-list.json', 'visual-brief.md'],
  producer: ['source-manifest.json', 'vision-evidence.json', 'shot-selection.json', 'story.md', 'visual-brief.md', 'edit-decision-list.json', 'music-plan.json', 'video.md'],
});
const SHA = b => createHash('sha256').update(b).digest('hex');
const verifiedMedia = new Map();
function mediaSHA(file) {
  const st = statSync(file);
  const key = [file, st.ino, st.size, st.mtimeMs, st.ctimeMs].join(':');
  if (verifiedMedia.has(key)) return verifiedMedia.get(key);
  const hash = createHash('sha256'), buffer = Buffer.allocUnsafe(1024 * 1024);
  const handle = openSync(file, 'r');
  try {
    for (let read; (read = readSync(handle, buffer, 0, buffer.length, null)) > 0;)
      hash.update(buffer.subarray(0, read));
  } finally { closeSync(handle); }
  const actual = hash.digest('hex');
  verifiedMedia.set(key, actual);
  return actual;
}
const data = (root, name) => JSON.parse(readFileSync(join(root, name), 'utf8'));
const inside = (root, file) => {
  const base = realpathSync(root);
  const abs = realpathSync(resolve(base, file));
  const rel = relative(base, abs);
  if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) throw new Error('Media path escapes private run');
  return abs;
};
const safeText = value => typeof value === 'string' ? value : '';
const parseRange = text => {
  const match = safeText(text).match(/([0-9]+(?:\.[0-9]+)?)\s*[-–]\s*([0-9]+(?:\.[0-9]+)?)\s*s?/);
  return match ? [Number(match[1]), Number(match[2])] : [null, null];
};

function sourcesFor(root) {
  const sourceManifest = data(root, 'source-manifest.json');
  if (sourceManifest.source_use?.approved !== true) throw new Error('Source-use permission missing');
  const manifest = new Map((sourceManifest.media ?? []).map(s => [s.sha256, s]));
  const vision = existsSync(join(root, 'vision-evidence.json')) ? data(root, 'vision-evidence.json') : {};
  const sources = (vision.sources ?? []).map(s => {
    if (!manifest.has(s.sha256)) throw new Error('Unapproved source: ' + s.id);
    const file = inside(root, s.path);
    const actual = mediaSHA(file);
    if (actual !== s.sha256) throw new Error('Source hash mismatch: ' + s.id);
    const frames = [];
    const observations = (s.observations ?? []).map((o, i) => {
      const range = parseRange(o.evidence?.time_range);
      for (const frame of o.evidence?.frames ?? []) {
        if (typeof frame !== 'string' || frames.some(f => f.path === frame)) continue;
        try {
          const filePath = inside(root, frame);
          if (!/\.jpe?g$/i.test(filePath)) continue;
          frames.push({ id: frames.length, path: frame, timeSeconds: Number(frame.match(/([0-9]+(?:\.[0-9]+)?)s\.(?:jpe?g)$/i)?.[1] ?? 0) });
        } catch { /* unavailable frames remain explicitly absent */ }
      }
      return {
      id: 'fact-' + i,
      text: safeText(o.claim || o.description),
      evidence: o.evidence?.source ?? s.path,
      region: safeText(o.evidence?.region),
      startSeconds: o.evidence?.start_seconds ?? o.start_seconds ?? o.evidence?.time_seconds ?? range[0],
      endSeconds: o.evidence?.end_seconds ?? o.end_seconds ?? range[1],
      uncertainty: safeText(o.evidence?.inference_limit),
    }; });
    const uncertainty = [s.uncertainty, s.markcut_metadata_limit, ...(observations.map(o => o.uncertainty))]
      .filter(Boolean).map(safeText);
    return {
      id: s.id, file, name: s.path.split('/').at(-1), type: s.media_type,
      hash: s.sha256, durationSeconds: s.duration_seconds ?? null,
      observations, uncertainty, frames,
    };
  });
  if (!sources.length) throw new Error('Vision evidence has no approved sources');
  return sources;
}

function stageContent(root, stage, sources) {
  if (stage === 'visioner') return {
    sources: sources.map(({ file, ...s }) => s),
    note: 'Original source evidence only; owner testimony is kept outside model facts.',
  };
  if (stage === 'director') {
    const selected = data(root, 'shot-selection.json');
    return {
      story: readFileSync(join(root, 'story.md'), 'utf8'),
      brief: readFileSync(join(root, 'visual-brief.md'), 'utf8'),
      shots: (selected.shots ?? selected.selection_context?.shots ?? []).map(s => ({
        id: s.id, sourceId: s.source_id, beat: s.beat, evidenceRef: s.evidence_ref,
        startSeconds: s.candidate_start_seconds ?? 0,
        endSeconds: s.candidate_end_seconds ?? s.still_duration_seconds ?? null,
        reason: s.rationale ?? '', transition: s.transition_intent ?? '',
      })),
    };
  }
  if (stage === 'editor') {
    const edl = data(root, 'edit-decision-list.json');
    return {
      timeline: (edl.edits ?? []).map((s, index) => ({
        id: s.shot_id, sourceId: s.source_id, order: s.order ?? index + 1,
        beat: s.beat, startSeconds: s.in_seconds, endSeconds: s.out_seconds,
        durationSeconds: s.target_duration_seconds ?? s.out_seconds - s.in_seconds,
        transitionIn: s.transition_in ?? '', transitionOut: s.transition_out ?? '',
        transitionReason: s.transition_relationship ?? '',
        audio: s.audio_treatment ?? '', caption: s.graphics ?? '',
        motive: s.story_intent ?? '', visual: s.visual_treatment ?? '',
      })),
    };
  }
  return {
    canonicalVideo: 'video.md',
    note: 'The required approval belongs only to the latest native neo.markcut_preview decision. This local UI cannot approve production.',
  };
}

export function snapshot(runRoot, stage) {
  if (!STAGE_FILES[stage]) throw new Error('Unknown stage');
  const root = realpathSync(runRoot);
  if (!root.includes('/vlog/runs/')) throw new Error('Review run must reside in the canonical private vlog/runs tree');
  const dependencies = [...STAGE_FILES[stage], ...(stage === 'producer' &&
    existsSync(join(root, 'assets/captions.vtt')) ? ['assets/captions.vtt'] : [])];
  const hashes = Object.fromEntries(dependencies.map(name => {
    const file = inside(root, name);
    return [name, SHA(readFileSync(file))];
  }));
  const sources = sourcesFor(root);
  const mediaHashes = Object.fromEntries(sources.map(s => [s.id, s.hash]));
  const frameHashes = Object.fromEntries(sources.flatMap(s =>
    s.frames.map(f => [s.id + '/' + f.path, mediaSHA(inside(root, f.path))])));
  const contentHash = SHA(JSON.stringify({ stage, hashes, mediaHashes, frameHashes }));
  const revisionId = stage + '-' + contentHash.slice(0, 20);
  return { stage, revisionId, contentHash, hashes, mediaHashes, frameHashes, reviewType: {
    visioner: 'source-evidence', director: 'storyboard',
    editor: 'edit-timeline', producer: 'markcut-media',
  }[stage], content: stageContent(root, stage, sources),
  sources: sources.map(({ file, ...s }) => s), status: 'awaiting_feedback' };
}

function reviewDir(root, stage) { return join(root, 'reviews', 'stages', stage); }
export function startReview(root, stage) {
  const current = snapshot(root, stage);
  const directory = reviewDir(root, stage);
  mkdirSync(join(directory, 'revisions'), { recursive: true });
  const revisionFile = join(directory, 'revisions', current.revisionId + '.json');
  if (!existsSync(revisionFile)) writeFileSync(revisionFile, JSON.stringify({
    ...current, createdAt: new Date().toISOString(), status: 'awaiting_feedback',
  }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return current;
}

const clampTime = (value, duration) => {
  if (value == null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 ||
      (duration != null && value > duration + 0.001)) throw new Error('Invalid source timestamp');
  return value;
};
const commentKinds = new Set(['source_correction', 'guidance', 'change_request']);
export function submitFeedback(root, stage, submission) {
  const current = snapshot(root, stage);
  if (submission.revisionId !== current.revisionId || submission.contentHash !== current.contentHash) {
    throw new Error('Stale revision: refresh before commenting');
  }
  if (!commentKinds.has(submission.kind)) throw new Error('Unsupported feedback kind');
  const text = safeText(submission.text).trim();
  if (!text || text.length > 4000) throw new Error('Comment must contain 1–4000 characters');
  const sources = sourcesFor(root);
  const source = sources.find(s => s.id === submission.sourceId);
  if (submission.sourceId && !source) throw new Error('Unknown source');
  if (stage === 'visioner' && !source) throw new Error('Visioner comment needs source identity');
  const targets = stage === 'director' ? current.content.shots : stage === 'editor' ? current.content.timeline : [];
  if (submission.shotId && !targets.some(s => s.id === submission.shotId))
    throw new Error('Unknown stage shot');
  if ((stage === 'director' || stage === 'editor') && !submission.shotId)
    throw new Error('Storyboard/timeline comment needs shot identity');
  if (submission.sourceId && submission.shotId &&
      targets.find(s => s.id === submission.shotId)?.sourceId !== submission.sourceId)
    throw new Error('Source/shot mismatch');
  if (!source && submission.timeSeconds != null) throw new Error('Timestamp needs source');
  const timeSeconds = clampTime(submission.timeSeconds ?? null, source?.durationSeconds);
  if (timeSeconds != null && source?.type !== 'video' && timeSeconds !== 0)
    throw new Error('Still-photo timestamp must be omitted or 0');
  const record = {
    schema_version: 1, stage, revisionId: current.revisionId, contentHash: current.contentHash,
    owner: 'interactive_reviewer', kind: submission.kind, sourceId: source?.id ?? null,
    sourceHash: source?.hash ?? null, shotId: submission.shotId ?? null, timeSeconds,
    text, receivedAt: new Date().toISOString(),
    workerAction: 'pending', appliedRevisionId: null, // worker must explicitly apply and re-preview
  };
  const directory = reviewDir(root, stage);
  mkdirSync(directory, { recursive: true });
  appendFileSync(join(directory, 'feedback.jsonl'), JSON.stringify(record) + '\n', { mode: 0o600 });
  if (submission.kind === 'source_correction') {
    // Human testimony is never merged silently into immutable machine observations.
    appendFileSync(join(root, 'reviews', 'owner-source-corrections.jsonl'),
      JSON.stringify({ ...record, provenance: 'owner_testimony_unverified' }) + '\n', { mode: 0o600 });
  }
  return record;
}

export function reviewStatus(root, stage) {
  const current = snapshot(root, stage);
  const path = join(reviewDir(root, stage), 'feedback.jsonl');
  const feedback = existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n')
    .filter(Boolean).map(line => JSON.parse(line)) : [];
  const resolutionPath = join(reviewDir(root, stage), 'resolutions.jsonl');
  const resolutions = existsSync(resolutionPath) ? readFileSync(resolutionPath, 'utf8').trim()
    .split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
  const resolved = new Set(resolutions.map(r => r.feedbackKey));
  const outstandingFeedback = feedback.filter(f => !resolved.has(feedbackKey(f)));
  const pending = outstandingFeedback.filter(f => f.revisionId === current.revisionId);
  return { ...current,
    feedback: pending.map(f => ({ ...f, feedbackKey: feedbackKey(f) })),
    outstandingFeedback: outstandingFeedback.map(f => ({ ...f, feedbackKey: feedbackKey(f) })),
    historicalFeedbackCount: feedback.length,
    status: pending.length ? 'feedback_received_requires_worker_revision'
      : outstandingFeedback.length ? 'outstanding_feedback_from_prior_revision' : 'awaiting_feedback' };
}

export const feedbackKey = f => SHA(JSON.stringify([f.stage, f.revisionId, f.contentHash,
  f.kind, f.sourceId, f.shotId, f.timeSeconds, f.text, f.receivedAt]));

export function resolveFeedback(root, stage, { feedbackRevisionId, feedbackKey: key, disposition, explanation }) {
  if (!['applied', 'not_applied_with_reason'].includes(disposition)) throw new Error('Invalid disposition');
  if (!safeText(explanation).trim()) throw new Error('Explanation required');
  const current = snapshot(root, stage);
  const { outstandingFeedback } = reviewStatus(root, stage);
  const match = outstandingFeedback.find(f => f.revisionId === feedbackRevisionId && feedbackKey(f) === key);
  if (!match) throw new Error('Unknown or already resolved feedback');
  if (disposition === 'applied' && current.contentHash === match.contentHash)
    throw new Error('Cannot claim applied without a changed reviewed artifact');
  const record = { feedbackKey: key, feedbackRevisionId, newRevisionId: current.revisionId,
    newContentHash: current.contentHash, disposition, explanation: explanation.trim(),
    recordedAt: new Date().toISOString(), actor: 'stage_worker' };
  appendFileSync(join(reviewDir(root, stage), 'resolutions.jsonl'), JSON.stringify(record) + '\n', { mode: 0o600 });
  return record;
}

export function mediaPath(root, stage, id, frameIndex = null) {
  const source = sourcesFor(root).find(s => s.id === id);
  if (!source) throw new Error('Unknown source identity');
  if (frameIndex === null) return source.file;
  const frame = source.frames[frameIndex];
  if (!frame) throw new Error('Unknown evidence frame');
  return inside(root, frame.path);
}
