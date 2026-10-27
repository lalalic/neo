import path from 'node:path';

const SHA256 = /^[a-f0-9]{64}$/i;
const ID = /^[a-z0-9][a-z0-9_-]*$/i;

export function validateTourDirector(index) {
  const issues = [];
  if (index?.version !== 1 || !index?.tour_id || !Array.isArray(index?.shots)) issues.push('Invalid Tour manifest');
  const ids = new Set();
  for (const shot of index?.shots ?? []) {
    if (!ID.test(shot.id ?? '') || ids.has(shot.id)) issues.push('Duplicate/invalid shot ID');
    ids.add(shot.id);
    const recordings = shot.library?.recordings;
    if (!Array.isArray(recordings)) { issues.push(`${shot.id}: missing library recordings`); continue; }
    const revisions = new Set();
    for (const take of recordings) {
      if (!ID.test(take.recording_id ?? '') || revisions.has(take.recording_id)) issues.push(`${shot.id}: duplicate/invalid recording ID`);
      revisions.add(take.recording_id);
      if (!['archived', 'disabled'].includes(take.status)) issues.push(`${shot.id}: invalid recording status`);
      if (!SHA256.test(take.sha256 ?? '')) issues.push(`${shot.id}: missing SHA-256`);
      if (!isSafeMediaPath(take.media_path)) issues.push(`${shot.id}: unsafe media path`);
    }
    const active = shot.library?.active_recording_id;
    if (active != null && !recordings.some(x => x.recording_id === active && x.status === 'archived')) issues.push(`${shot.id}: active recording is not archived`);
  }
  return issues;
}

function isSafeMediaPath(p) {
  if (typeof p !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}[^/]*\/media\//.test(p) || p.includes('\\') || p.includes('\0')) return false;
  const normalized = path.posix.normalize(p);
  return normalized === p && !p.split('/').includes('..') && p.split('/').length >= 3;
}

/** Append an immutable take; replacing means changing only the active pointer. */
export function appendTourRecording(index, shotId, take) {
  const next = structuredClone(index);
  const shot = next.shots.find(s => s.id === shotId);
  if (!shot) throw new Error(`Unknown Tour shot: ${shotId}`);
  if (!ID.test(take?.recording_id ?? '') || !SHA256.test(take?.sha256 ?? '') || !isSafeMediaPath(take?.media_path)) throw new Error('Invalid recording evidence');
  if (shot.library.recordings.some(r => r.recording_id === take.recording_id)) throw new Error('Recording ID already exists');
  shot.library.recordings.push({
    recording_id: take.recording_id,
    status: 'archived',
    media_path: take.media_path,
    sha256: take.sha256,
    duration_s: take.duration_s,
    captured_at: take.captured_at,
    source_tour_session_id: take.source_tour_session_id,
    source_media_reference: take.source_media_reference,
    topics: take.topics ?? [shot.notes?.topic].filter(Boolean),
    transcript_path: take.transcript_path ?? null,
    summary: take.summary ?? null,
    public_use_approved: take.public_use_approved === true,
  });
  shot.library.active_recording_id = take.recording_id;
  shot.library.status = 'archived';
  const issues = validateTourDirector(next);
  if (issues.length) throw new Error(issues.join('; '));
  return next;
}

/** Director reads only verified indexed media, never unrecorded prompts. */
export function selectTourReferences(index, { topics = [], publicInsert = false } = {}) {
  if (validateTourDirector(index).length) throw new Error('Invalid Tour Director index');
  return index.shots.flatMap(shot => {
    const take = shot.library.recordings.find(r => r.recording_id === shot.library.active_recording_id && r.status === 'archived');
    if (!take || (topics.length && !topics.some(t => take.topics.includes(t)))) return [];
    if (publicInsert && !(take.public_use_approved && shot.library.use_policy?.public_insert)) return [];
    return [{ shot_id: shot.id, title: shot.title, ...take, allowed_use: publicInsert ? 'historical_insert' : 'private_story_reference' }];
  });
}
