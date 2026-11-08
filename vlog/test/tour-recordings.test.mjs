import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const sourceRoot = resolve(import.meta.dirname, '..');
const tour = join(sourceRoot, 'scripts/tour-recordings.mjs');
const tourLib = join(sourceRoot, 'lib/tour-director-index.mjs');
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'tour-recordings-'));
  const vlog = join(root, 'vlog');
  const library = join(vlog, 'assets/personal-library');
  const scripts = join(vlog, 'scripts');
  const lib = join(vlog, 'lib');
  mkdirSync(library, { recursive: true, mode: 0o700 });
  mkdirSync(scripts);
  mkdirSync(lib);
  chmodSync(library, 0o700);
  copyFileSync(tour, join(scripts, 'tour-recordings.mjs'));
  copyFileSync(tourLib, join(lib, 'tour-director-index.mjs'));
  const index = join(library, 'tour-director.json');
  const makeShot = id => ({
    id, title: id, kind: 'talking_head', notes: { topic: id === 'pv01' ? 'daily_life' : 'humor' },
    library: { status: 'unrecorded', active_recording_id: null, recordings: [],
      use_policy: { public_insert: false } },
  });
  writeFileSync(index, JSON.stringify({ version: 1, tour_id: 'stories', title: 'Recorded Tour',
    shots: [makeShot('pv01'), makeShot('pv02')] }), { mode: 0o600 });
  const movie = join(root, 'accepted.mov');
  writeFileSync(movie, Buffer.from('test-only accepted tour movie bytes'));
  const command = (name, ...args) => spawnSync(process.execPath, [join(scripts, 'tour-recordings.mjs'), name, ...args], { encoding: 'utf8' });
  const archiveFlags = ['--shot', 'pv01', '--file', movie, '--session', 'real-session-01',
    '--ref', '/files/accepted01.mov', '--captured-at', '2026-11-07T19:50:00-05:00', '--duration', '24.5'];
  return { root, vlog, index, movie, library, command, archiveFlags,
    script: join(scripts, 'tour-recordings.mjs'), clean: () => rmSync(root, { recursive: true, force: true }) };
}
function ok(result) { assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout); }
function replaceFlag(flags, key, value) { const args = [...flags]; args[args.indexOf(key) + 1] = value; return args; }

test('Tour manifest is usable by tour.start but no prompt can masquerade as a recorded take', () => {
  const f = fixture();
  try {
    const manifest = ok(f.command('manifest'));
    assert.equal(manifest.shots.length, 2);
    assert.equal(Object.hasOwn(manifest.shots[0], 'library'), false);
    assert.deepEqual(ok(f.command('list')), []);
  } finally { f.clean(); }
});
test('archive a real local file once, verify hash, and expose only archived active take', () => {
  const f = fixture();
  try {
    const first = ok(f.command('archive', ...f.archiveFlags, '--recording-id', 'record01'));
    assert.equal(first.archived, true);
    assert.equal(first.reused, false);
    const selected = ok(f.command('list', '--topics', 'daily_life'));
    assert.equal(selected.length, 1);
    assert.equal(selected[0].recording_id, 'record01');
    assert.equal(readFileSync(selected[0].local_path, 'utf8'), readFileSync(f.movie, 'utf8'));
    assert.equal(selected[0].sha256, first.sha256);
    assert.equal(ok(f.command('archive', ...f.archiveFlags, '--recording-id', 'record02')).reused, true);
    assert.equal(JSON.parse(readFileSync(f.index)).shots[0].library.recordings.length, 1);
    assert.deepEqual(ok(f.command('list', '--topics', 'humor')), []);
    assert.deepEqual(ok(f.command('list', '--public', 'true')), []);
    writeFileSync(selected[0].local_path, 'tampered');
    const broken = f.command('list');
    assert.equal(broken.status, 1);
    assert.match(broken.stderr, /TOUR_MEDIA_HASH_MISMATCH/);
  } finally { f.clean(); }
});
test('deny forged refs, source hash mismatch, duplicate identity with changed bytes, and unsafe privacy', () => {
  const f = fixture();
  try {
    let denied = f.command('archive', ...replaceFlag(f.archiveFlags, '--ref', '/wrong/path.mov'));
    assert.equal(denied.status, 1);
    assert.match(denied.stderr, /TOUR_INVALID_SOURCE_REFERENCE/);
    denied = f.command('archive', ...f.archiveFlags, '--sha256', 'a'.repeat(64));
    assert.equal(denied.status, 1);
    assert.match(denied.stderr, /TOUR_SOURCE_HASH_MISMATCH/);
    assert.deepEqual(ok(f.command('list')), []);
    ok(f.command('archive', ...f.archiveFlags));
    writeFileSync(f.movie, 'different take');
    denied = f.command('archive', ...f.archiveFlags);
    assert.equal(denied.status, 1);
    assert.match(denied.stderr, /TOUR_RECORDING_REPLAY_MISMATCH/);
    chmodSync(f.library, 0o755);
    denied = f.command('list');
    assert.equal(denied.status, 1);
    assert.match(denied.stderr, /TOUR_LIBRARY_NOT_PRIVATE/);
  } finally { f.clean(); }
});
test('parallel accepted takes do not overwrite the index', async () => {
  const f = fixture();
  try {
    const a = [...f.archiveFlags, '--recording-id', 'record01'];
    const b = [...replaceFlag(replaceFlag(f.archiveFlags, '--shot', 'pv02'), '--ref', '/files/accepted02.mov'),
      '--recording-id', 'record02'];
    await Promise.all([a, b].map(args => new Promise((resolvePromise, reject) => {
      const child = spawn(process.execPath, [f.script, 'archive', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
      let errors = ''; child.stderr.on('data', x => errors += x);
      child.on('error', reject);
      child.on('close', code => code === 0 ? resolvePromise() : reject(Error('archive failed: ' + errors)));
    })));
    assert.equal(ok(f.command('list')).length, 2);
    assert.equal(existsSync(join(f.library, '.recordings.lock')), false);
  } finally { f.clean(); }
});
