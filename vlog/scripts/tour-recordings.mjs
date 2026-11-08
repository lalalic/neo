#!/usr/bin/env node
/** Archive accepted Capture Tour recordings into a private, verified Vlog reference index. */
import {
  copyFileSync, chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync,
  readSync, realpathSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendTourRecording, selectTourReferences, validateTourDirector } from '../lib/tour-director-index.mjs';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const library = join(project, 'assets', 'personal-library');
const indexPath = join(library, 'tour-director.json');
const safeId = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;
const mediaExtensions = new Set(['.mov', '.mp4', '.m4v']);
const inside = (root, path) => {
  const rel = relative(root, path);
  return rel !== '' && rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel);
};
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fileSha = path => {
  const hasher = createHash('sha256');
  const handle = openSync(path, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytes;
    while ((bytes = readSync(handle, buffer, 0, buffer.length, null)) > 0)
      hasher.update(buffer.subarray(0, bytes));
    return hasher.digest('hex');
  } finally { closeSync(handle); }
};
const wait = () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);

function checkLibrary() {
  const stat = lstatSync(library);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0)
    throw Error('TOUR_LIBRARY_NOT_PRIVATE: assets/personal-library must be mode 0700');
}
function readIndex() {
  checkLibrary();
  const st = lstatSync(indexPath);
  if (!st.isFile() || st.isSymbolicLink()) throw Error('TOUR_INDEX_UNSAFE');
  const index = JSON.parse(readFileSync(indexPath, 'utf8'));
  const errors = validateTourDirector(index);
  if (errors.length) throw Error('TOUR_INDEX_INVALID: ' + errors.join('; '));
  return index;
}
function withLock(action) {
  checkLibrary();
  const lock = join(library, '.recordings.lock');
  let locked = false;
  for (let i = 0; i < 40; i++) {
    try { mkdirSync(lock, { mode: 0o700 }); locked = true; break; }
    catch (e) { if (e.code !== 'EEXIST') throw e; if (i === 39) throw Error('TOUR_INDEX_LOCK_BUSY'); wait(); }
  }
  try { return action(); }
  finally { if (locked) rmSync(lock, { recursive: true, force: true }); }
}
function saveIndex(index) {
  const tmp = join(library, '.tour-index-' + randomUUID() + '.tmp');
  try {
    writeFileSync(tmp, JSON.stringify(index, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    renameSync(tmp, indexPath);
  } finally { rmSync(tmp, { force: true }); }
}
function parseFlags(args) {
  const flags = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    if (!/^--[a-z][a-z0-9-]*$/.test(key || '') || !args[i + 1] || key in flags)
      throw Error('TOUR_INVALID_ARGUMENTS');
    flags[key] = args[i + 1];
  }
  return flags;
}
function assertMedia(file) {
  const absolute = resolve(file);
  const st = lstatSync(absolute);
  if (st.isSymbolicLink() || !st.isFile() || !st.size ||
      !mediaExtensions.has(extname(absolute).toLowerCase()))
    throw Error('TOUR_INVALID_MEDIA: requires a nonempty local .mov/.mp4/.m4v recording');
  return absolute;
}
function verifiedPath(rel, expectedHash) {
  const full = resolve(library, rel);
  if (!inside(library, full)) throw Error('TOUR_MEDIA_PATH_ESCAPE');
  const parts = relative(library, full).split(sep);
  let current = library;
  for (const part of parts) {
    current = join(current, part);
    if (lstatSync(current).isSymbolicLink()) throw Error('TOUR_MEDIA_SYMLINK');
  }
  if (!statSync(full).isFile() || fileSha(full) !== expectedHash)
    throw Error('TOUR_MEDIA_HASH_MISMATCH: ' + rel);
  return full;
}
function archive(flags) {
  const required = ['--shot', '--file', '--session', '--ref', '--captured-at', '--duration'];
  for (const key of required) if (!flags[key]) throw Error('TOUR_REQUIRED: ' + key);
  const shotId = flags['--shot'];
  if (!safeId.test(shotId) || !safeId.test(flags['--session']))
    throw Error('TOUR_INVALID_ID');
  if (!/^\/files\/[^\s?#]+$/.test(flags['--ref']) || flags['--ref'].includes('..'))
    throw Error('TOUR_INVALID_SOURCE_REFERENCE: accepted tour.status /files path required');
  const capturedAt = flags['--captured-at'];
  if (!/^\d{4}-\d{2}-\d{2}T/.test(capturedAt) || !Number.isFinite(Date.parse(capturedAt)))
    throw Error('TOUR_INVALID_CAPTURE_TIME');
  const duration = Number(flags['--duration']);
  if (!(duration > 0 && duration < 86400)) throw Error('TOUR_INVALID_DURATION');
  const source = assertMedia(flags['--file']);
  const actualHash = fileSha(source);
  if (flags['--sha256'] && flags['--sha256'].toLowerCase() !== actualHash)
    throw Error('TOUR_SOURCE_HASH_MISMATCH');
  const recordId = flags['--recording-id'] || randomUUID().replaceAll('-', '');
  if (!safeId.test(recordId)) throw Error('TOUR_INVALID_RECORDING_ID');
  const collection = flags['--collection'] || capturedAt.slice(0, 10) + '-tour-' + sha(flags['--session']).slice(0, 12);
  if (!/^\d{4}-\d{2}-\d{2}-[A-Za-z0-9_-]+$/.test(collection))
    throw Error('TOUR_INVALID_COLLECTION');
  return withLock(() => {
    const index = readIndex();
    const shot = index.shots.find(x => x.id === shotId);
    if (!shot) throw Error('TOUR_UNKNOWN_SHOT');
    const existing = shot.library.recordings.find(x =>
      x.source_tour_session_id === flags['--session'] && x.source_media_reference === flags['--ref']);
    if (existing) {
      if (existing.sha256 !== actualHash) throw Error('TOUR_RECORDING_REPLAY_MISMATCH');
      verifiedPath(existing.media_path, existing.sha256);
      return { archived: true, reused: true, shot_id: shotId, ...existing };
    }
    const mediaPath = collection + '/media/' + shotId + '-' + recordId + extname(source).toLowerCase();
    const destination = join(library, mediaPath);
    if (existsSync(destination)) throw Error('TOUR_RECORDING_ALREADY_EXISTS');
    const take = {
      recording_id: recordId,
      media_path: mediaPath,
      sha256: actualHash,
      duration_s: duration,
      captured_at: capturedAt,
      source_tour_session_id: flags['--session'],
      source_media_reference: flags['--ref'],
      topics: [shot.notes?.topic].filter(Boolean),
      public_use_approved: false,
    };
    const updated = appendTourRecording(index, shotId, take);
    const collectionRoot = join(library, collection);
    const folder = join(collectionRoot, 'media');
    // Validate each existing parent before creating descendants; never follow a planted symlink.
    for (const path of [collectionRoot, folder]) {
      if (existsSync(path)) {
        const st = lstatSync(path);
        if (!st.isDirectory() || st.isSymbolicLink()) throw Error('TOUR_UNSAFE_DESTINATION');
      } else mkdirSync(path, { mode: 0o700 });
      chmodSync(path, 0o700);
    }
    const temporary = join(folder, '.' + basename(destination) + '.' + randomUUID() + '.tmp');
    let committed = false;
    try {
      copyFileSync(source, temporary);
      chmodSync(temporary, 0o600);
      if (fileSha(temporary) !== actualHash) throw Error('TOUR_MEDIA_COPY_MISMATCH');
      renameSync(temporary, destination);
      saveIndex(updated);
      committed = true;
    } finally {
      rmSync(temporary, { force: true });
      if (!committed) rmSync(destination, { force: true });
    }
    return { archived: true, reused: false, shot_id: shotId, ...take };
  });
}
function list(flags) {
  const index = readIndex();
  const topics = flags['--topics'] ? flags['--topics'].split(',').filter(Boolean) : [];
  const selected = selectTourReferences(index, {
    topics, publicInsert: flags['--public'] === 'true',
  });
  return selected.map(take => ({
    ...take,
    local_path: verifiedPath(take.media_path, take.sha256),
  }));
}
function manifest() {
  const index = readIndex();
  return { version: index.version, tour_id: index.tour_id, title: index.title,
    shots: index.shots.map(({ library: ignored, ...shot }) => shot) };
}
export function command(args) {
  const [operation, ...rest] = args;
  if (operation === 'manifest') return manifest();
  if (operation === 'list') return list(parseFlags(rest));
  if (operation === 'archive') return archive(parseFlags(rest));
  throw Error('Usage: tour-recordings.mjs manifest | list [--topics TOPIC] [--public true] | archive --shot ID --file DOWNLOADED_MOV --session TOUR_SESSION --ref /files/ACCEPTED_PATH --captured-at ISO8601 --duration SECONDS [--sha256 HASH] [--recording-id ID]');
}
if (process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) {
  try { console.log(JSON.stringify(command(process.argv.slice(2)), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
