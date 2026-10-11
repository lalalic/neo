import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const hash = value => createHash('sha256').update(value).digest('hex');
const assert = (condition, why) => { if (!condition) throw Error(why); };
const filled = value => typeof value === 'string' && value.trim().length > 0;

// Independent admission gate: the legacy inbox transport manifest stays compatible.
export async function validateEpisodeSources(rootDir, manifest) {
  assert(manifest?.schema_version === 1, 'invalid source schema');
  const from = Date.parse(manifest.source_window?.start);
  const to = Date.parse(manifest.source_window?.end);
  assert(Number.isFinite(from) && Number.isFinite(to) && from <= to, 'invalid source window');
  assert(filled(manifest.episode_intent), 'missing episode intent');
  assert(Array.isArray(manifest.items) && manifest.items.length, 'INSUFFICIENT_SOURCE');
  const root = await fs.realpath(rootDir);
  const ids = new Set();
  for (const item of manifest.items) {
    assert(filled(item.id) && !ids.has(item.id), 'invalid source id');
    ids.add(item.id);
    const relative = item.local_relative_path;
    assert(filled(relative) && !path.isAbsolute(relative) && !relative.includes('\0'), 'invalid source path');
    const file = path.resolve(root, relative);
    const subpath = path.relative(root, file);
    assert(subpath && subpath !== '..' && !subpath.startsWith('..' + path.sep) && !path.isAbsolute(subpath), 'source outside run');
    const stat = await fs.lstat(file).catch(() => null);
    assert(stat?.isFile() && !stat.isSymbolicLink() && stat.size > 0, 'missing/empty/symlink media');
    assert(/^[0-9a-f]{64}$/.test(item.sha256 ?? '') && hash(await fs.readFile(file)) === item.sha256, 'invalid media checksum');
    assert(['phone','inbox','manual'].includes(item.origin), 'unverified media origin');
    assert(['video','audio','image'].includes(item.media_type), 'invalid media type');
    assert(item.permission?.owner_confirmed === true && item.permission?.use_approved === true, 'unapproved source rights');
    const capture = Date.parse(item.captured_at);
    assert(Number.isFinite(capture) && capture >= from && capture <= to, 'unverified capture time');
    assert(typeof item.original_audio === 'boolean', 'original audio unknown');
    assert(Number.isFinite(item.duration) && item.duration > 0, 'duration unknown');
    assert(Array.isArray(item.selected_ranges) && item.selected_ranges.length, 'missing source selection');
    for (const range of item.selected_ranges) {
      assert(Number.isFinite(range.start) && Number.isFinite(range.end) && range.start >= 0 && range.end > range.start && range.end <= item.duration, 'invalid source range');
    }
  }
  return { admissible: true, count: ids.size };
}

export function validateReviewGate(markcut, reviews) {
  const draft_sha256 = hash(markcut);
  for (const role of ['video-director', 'market']) {
    const review = reviews?.[role];
    assert(review?.status === 'PASS' && review.draft_sha256 === draft_sha256 && filled(review.reviewer) && filled(review.reviewed_at), role + ' approval missing or stale');
  }
  return { approved: true, draft_sha256 };
}

export function validatePlaybackQA(qa) {
  const categories = { source:20, narrative:15, shots:15, visual:15, pacing:10, sound:15, graphics:10 };
  assert(qa?.played_entire_render === true && /^[0-9a-f]{64}$/.test(qa.render_sha256 ?? '') && filled(qa.player) && filled(qa.viewer) && filled(qa.playback_at), 'full playback evidence missing');
  assert(Array.isArray(qa.timecoded_observations) && qa.timecoded_observations.length, 'timecoded playback findings missing');
  assert(qa.critical_defects === 0, 'critical playback defects');
  let total = 0;
  for (const [category, maximum] of Object.entries(categories)) {
    const score = qa.scores?.[category];
    assert(Number.isFinite(score) && score >= maximum * 0.7 && score <= maximum, category + ' below required score');
    total += score;
  }
  assert(total >= 85, 'QA revision required: ' + total);
  return { passed: true, total };
}
