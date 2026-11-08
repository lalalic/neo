const SHA256 = /^[a-f0-9]{64}$/i;
const ID = /^[a-z0-9][a-z0-9_-]*$/i;
const SLUG = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/;

export function validateTourDirector(index) {
  const issues = [];
  if (index?.version !== 1 || !index?.tour_id || !Array.isArray(index?.shots)) issues.push('Invalid Tour manifest');
  const ids = new Set();
  for (const shot of index?.shots ?? []) {
    if (!ID.test(shot.id ?? '') || ids.has(shot.id)) issues.push('Duplicate/invalid shot ID');
    ids.add(shot.id);
    if (!SLUG.test(shot.filename_hint ?? '')) issues.push(`${shot.id}: missing descriptive filename hint`);
    const recordings = shot.library?.recordings;
    if (!Array.isArray(recordings)) { issues.push(`${shot.id}: missing library recordings`); continue; }
    const revisions = new Set();
    for (const take of recordings) {
      if (!ID.test(take.recording_id ?? '') || revisions.has(take.recording_id)) issues.push(`${shot.id}: duplicate/invalid recording ID`);
      revisions.add(take.recording_id);
      if (!['archived', 'disabled'].includes(take.status)) issues.push(`${shot.id}: invalid recording status`);
      if (!SHA256.test(take.sha256 ?? '')) issues.push(`${shot.id}: missing SHA-256`);
      if (!isSafeMediaPath(take.media_path) || !descriptiveMediaName(shot.id, take))
        issues.push(`${shot.id}: media filename must describe the content and contain date/take ID`);
      if (typeof take.title !== 'string' || !take.title.trim())
        issues.push(`${shot.id}: missing recorded-media title`);
      if (typeof take.description !== 'string' || take.description.trim().length < 8)
        issues.push(`${shot.id}: missing actual recorded-media description`);
    }
    const active = shot.library?.active_recording_id;
    if (active != null && !recordings.some(x => x.recording_id === active && x.status === 'archived')) issues.push(`${shot.id}: active recording is not archived`);
  }
  return issues;
}

function isSafeMediaPath(p) {
  // The Tour director index and every archived recording share one private folder.
  return typeof p === 'string' && /^[a-z0-9][a-z0-9_-]*\.(?:mov|mp4|m4v|m4a|wav)$/i.test(p);
}

function descriptiveMediaName(shotId, take) {
  // Example: pv01-weekend-walk-opening-20261107-take01.mov
  if (!isSafeMediaPath(take?.media_path) || !ID.test(take?.recording_id ?? '') ||
      !/^\d{4}-\d{2}-\d{2}T/.test(take?.captured_at ?? '')) return false;
  const date = take.captured_at.slice(0, 10).replaceAll('-', '');
  const ext = take.media_path.slice(take.media_path.lastIndexOf('.'));
  const prefix = shotId + '-';
  const suffix = '-' + date + '-' + take.recording_id + ext;
  if (!take.media_path.startsWith(prefix) || !take.media_path.endsWith(suffix)) return false;
  return SLUG.test(take.media_path.slice(prefix.length, -suffix.length));
}

/** Append an immutable take; replacing means changing only the active pointer. */
export function appendTourRecording(index, shotId, take) {
  const next = structuredClone(index);
  const shot = next.shots.find(s => s.id === shotId);
  if (!shot) throw new Error(`Unknown Tour shot: ${shotId}`);
  if (!ID.test(take?.recording_id ?? '') || !SHA256.test(take?.sha256 ?? '') ||
      !descriptiveMediaName(shotId, take) || !take?.title?.trim() || !take?.description?.trim() ||
      take.description.trim().length < 8) throw new Error('Invalid descriptive recording evidence');
  if (shot.library.recordings.some(r => r.recording_id === take.recording_id)) throw new Error('Recording ID already exists');
  shot.library.recordings.push({
    recording_id: take.recording_id,
    status: 'archived',
    title: take.title.trim(),
    description: take.description.trim(),
    media_path: take.media_path,
    sha256: take.sha256,
    duration_s: take.duration_s,
    captured_at: take.captured_at,
    source_tour_session_id: take.source_tour_session_id,
    source_media_reference: take.source_media_reference,
    topics: take.topics ?? [shot.notes?.topic].filter(Boolean),
    transcript_path: take.transcript_path ?? null,
    public_use_approved: take.public_use_approved === true,
  });
  shot.library.active_recording_id = take.recording_id;
  shot.library.status = 'archived';
  const issues = validateTourDirector(next);
  if (issues.length) throw new Error(issues.join('; '));
  return next;
}

/** Editor selects only accepted indexed Tour recordings, never unrecorded prompts. */
export function selectTourReferences(index, { topics = [], publicInsert = false, allTakes = false } = {}) {
  if (validateTourDirector(index).length) throw new Error('Invalid Tour Director index');
  return index.shots.flatMap(shot =>
    shot.library.recordings.filter(take =>
      take.status === 'archived' &&
      (allTakes || take.recording_id === shot.library.active_recording_id) &&
      (!topics.length || topics.some(topic => take.topics.includes(topic))) &&
      (!publicInsert || (take.public_use_approved && shot.library.use_policy?.public_insert))
    ).map(take => ({
      shot_id: shot.id,
      shot_title: shot.title,
      filename_hint: shot.filename_hint,
      ...take,
      is_active: take.recording_id === shot.library.active_recording_id,
      allowed_use: publicInsert ? 'historical_insert' : 'private_story_reference',
    }))
  );
}
