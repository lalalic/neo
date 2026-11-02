import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, statSync, createReadStream, existsSync, mkdirSync, renameSync, rmSync,
  openSync, readSync, closeSync } from 'node:fs';
import { extname, resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startReview, submitFeedback, reviewStatus, mediaPath, snapshot } from './stage-review.mjs';

const MIME = { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const respond = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(body));
};
const htmlPath = resolve(dirname(fileURLToPath(import.meta.url)), '../templates/stage-review.html');

// Original hashes stay authoritative; only a preview copy is remuxed for
// browser seeking when its moov index trails mdat. Strip GPS/data streams and
// container metadata from the preview copy. No re-encode or source edit.
function playbackCopies(root, stage) {
  const copies = new Map();
  for (const source of snapshot(root, stage).sources) {
    if (source.type !== 'video' || extname(source.name).toLowerCase() !== '.mp4') continue;
    const original = mediaPath(root, stage, source.id);
    // Inspect bounded slices, not the entire source (phone video may be GBs).
    const size = statSync(original).size, head = Buffer.alloc(Math.min(size, 65536));
    const tailOffset = Math.max(0, size - 1024 * 1024);
    const tail = Buffer.alloc(size - tailOffset);
    const fd = openSync(original, 'r');
    try {
      readSync(fd, head, 0, head.length, 0);
      readSync(fd, tail, 0, tail.length, tailOffset);
    } finally { closeSync(fd); }
    if (head.indexOf('mdat') < 0 ||
        (head.indexOf('moov') >= 0 && head.indexOf('moov') < head.indexOf('mdat')) ||
        tail.indexOf('moov') < 0) continue;
    const directory = join(root, 'reviews', 'stages', stage, 'playback');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const safeName = source.id.replace(/[^a-zA-Z0-9_-]/g, '_');
    const target = join(directory, safeName + '-' + source.hash.slice(0, 16) + '.mp4');
    if (!existsSync(target)) {
      const temp = target + '.part.mp4';
      const result = spawnSync('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-i', original,
        '-map', '0:v:0', '-map', '0:a?', '-map_metadata', '-1', '-map_chapters', '-1',
        '-c', 'copy', '-movflags', '+faststart', temp], { stdio: 'pipe' });
      if (result.status !== 0) { rmSync(temp, { force: true }); continue; }
      renameSync(temp, target);
    }
    copies.set(source.id, target);
  }
  return copies;
}

export async function serveReview({ runRoot, stage, port = 0 }) {
  startReview(runRoot, stage);
  const playback = playbackCopies(runRoot, stage);
  const token = randomBytes(24).toString('hex');
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.searchParams.get('token') !== token) return respond(res, 403, { error: 'Invalid session' });
      if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
          'Content-Security-Policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; media-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'" });
        res.end(readFileSync(htmlPath));return;
      }
      if (req.method === 'GET' && url.pathname === '/api/status')
        return respond(res, 200, reviewStatus(runRoot, stage));
      if (req.method === 'POST' && url.pathname === '/api/comment') {
        if (!req.headers['content-type']?.startsWith('application/json')) return respond(res, 415, { error: 'JSON only' });
        let raw = '';
        for await (const chunk of req) {
          raw += chunk.toString();
          if (raw.length > 12000) return respond(res, 413, { error: 'Comment too long' });
        }
        try { return respond(res, 201, submitFeedback(runRoot, stage, JSON.parse(raw))); }
        catch (e) { return respond(res, 409, { error: e.message }); }
      }
      if (req.method === 'GET' && (url.pathname.startsWith('/media/') || url.pathname.startsWith('/frame/'))) {
        const frame = url.pathname.startsWith('/frame/');
        const segments = url.pathname.slice(frame ? '/frame/'.length : '/media/'.length).split('/');
        const id = decodeURIComponent(segments[0]);
        const index = frame ? Number(segments[1]) : null;
        if (frame && (!Number.isInteger(index) || index < 0)) return respond(res, 400, { error: 'Invalid frame' });
        const file = !frame && playback.has(id) ? playback.get(id) : mediaPath(runRoot, stage, id, index);
        const size = statSync(file).size;
        const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
        const range = req.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
        if (req.headers.range && (!range || (!range[1] && !range[2])))
          return res.writeHead(416, { 'Content-Range': 'bytes */' + size }).end();
        const suffix = range && !range[1] ? Number(range[2]) : null;
        const start = suffix !== null ? Math.max(0, size - suffix) : range ? Number(range[1]) : 0;
        const end = suffix !== null ? size - 1 : range && range[2] ? Math.min(size - 1, Number(range[2])) : size - 1;
        if (start >= size || end < start)
          return res.writeHead(416, { 'Content-Range': 'bytes */' + size }).end();
        const headers = { 'Content-Type': type, 'Content-Length': end-start+1,
          'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
        if (range) headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + size;
        res.writeHead(range ? 206 : 200, headers);
        return createReadStream(file, { start, end }).pipe(res);
      }
      return respond(res, 404, { error: 'Not found' });
    } catch (e) { return respond(res, 400, { error: e.message }); }
  });
  await new Promise((resolve, reject) => server.listen(port, '127.0.0.1', resolve).once('error', reject));
  return { server, url: 'http://127.0.0.1:' + server.address().port + '/?token=' + token };
}
