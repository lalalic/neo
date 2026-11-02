/**
 * Batched image/video understanding through WebHelm's signed-in DeepSeek adapter.
 * One contact sheet is one browser upload; the caller gets independent, timestamped
 * observations for each tile. No network API keys or guessed browser DOM selectors.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { IMAGE_EXTS, VIDEO_EXTS } from './media-types.mjs';

const MODEL_VERSION = 'deepseek-contact-sheet-v2';
const WEBHELM = process.env.NEO_VISION_WEBHELM_CLI || 'webhelm';
const IMAGE_TILE_WIDTH = 420;
const IMAGE_TILE_HEIGHT = 280;
const DRAWTEXT_AVAILABLE = /\bdrawtext\b/.test(call("ffmpeg", ["-hide_banner", "-filters"], 30_000));

function call(command, args, timeout = 180_000) {
  return execFileSync(command, args, { encoding: 'utf8', timeout, maxBuffer: 16 * 1024 * 1024 });
}

function decodeReceipt(stdout) {
  const envelope = JSON.parse(stdout);
  if (envelope?.result?.ok !== true) {
    throw new Error(`WebHelm DeepSeek action failed: ${envelope?.result?.error || envelope?.result?.stderr || stdout.slice(0, 400)}`);
  }
  const reply = JSON.parse(envelope.result.stdout);
  if (!['completed', 'pending'].includes(reply.status)) {
    throw new Error(`Unexpected DeepSeek action status: ${reply.status || 'missing'}`);
  }
  return reply;
}

function parseReceipt(stdout) {
  const reply = decodeReceipt(stdout);
  if (reply.status !== 'completed' || typeof reply.answer !== 'string' || !reply.answer.trim()) {
    throw new Error(`DeepSeek result not completed (${reply.status || 'missing status'}); no metadata saved`);
  }
  return reply;
}

function parseTileAnswer(answer, tiles) {
  const body = answer.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const match = body.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const json = match ? match[1] : body.slice(body.indexOf('{'), body.lastIndexOf('}') + 1);
  let parsed;
  try { parsed = JSON.parse(json); }
  catch { throw new Error('DeepSeek did not return valid JSON with tile descriptions'); }
  if (!Array.isArray(parsed.tiles)) throw new Error('DeepSeek response must contain tiles array');
  const byId = new Map();
  for (const item of parsed.tiles) {
    if (!item || typeof item.id !== 'string' || typeof item.description !== 'string' || !item.description.trim()) continue;
    if (byId.has(item.id)) throw new Error(`DeepSeek returned duplicate tile id ${item.id}`);
    byId.set(item.id, item.description.trim());
  }
  const expected = new Set(tiles.map(tile => tile.id));
  if (byId.size !== expected.size || [...expected].some(id => !byId.has(id))) {
    throw new Error(`DeepSeek tile IDs mismatch: expected ${[...expected].join(', ')}, got ${[...byId.keys()].join(', ')}`);
  }
  return byId;
}

function videoDuration(path) {
  const value = Number(call('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', path], 30_000).trim());
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Video duration unavailable: ${basename(path)}`);
  return value;
}

function sampleVideo(path, dir, { maxFrames, sampleInterval }) {
  const duration = videoDuration(path);
  const count = Math.min(maxFrames, Math.max(2, Math.ceil(duration / sampleInterval)));
  const prefix = `frame-${createHash('sha1').update(path).digest('hex').slice(0, 12)}`;
  const pattern = join(dir, `${prefix}-%03d.jpg`);
  // Decode the source once, rather than spawning ffmpeg for every sample.
  call('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', path,
    '-vf', `fps=${count}/${duration},scale=640:-2`, '-frames:v', String(count),
    '-q:v', '4', pattern], 180_000);
  const paths = readdirSync(dir).filter(name => name.startsWith(`${prefix}-`) && name.endsWith('.jpg')).sort();
  if (!paths.length) throw new Error(`Video frame extraction failed: ${basename(path)}`);
  return paths.map((name, i) => ({ path: join(dir, name), seconds: Math.min(duration, duration * (i + 0.5) / paths.length), duration }));
}

/** All images are owned by the caller. We do not delete or mutate source media. */
function createContactSheet(tiles, output) {
  if (!tiles.length) throw new Error('Cannot generate empty contact sheet');
  const columns = Math.min(3, tiles.length);
  const args = ['-hide_banner', '-loglevel', 'error', '-y'];
  for (const tile of tiles) args.push('-i', tile.path);
  const filters = tiles.map((tile, i) => {
    const scaling = `[${i}:v]scale=${IMAGE_TILE_WIDTH - 12}:${IMAGE_TILE_HEIGHT - 12}:force_original_aspect_ratio=decrease,pad=${IMAGE_TILE_WIDTH}:${IMAGE_TILE_HEIGHT}:(ow-iw)/2:(oh-ih)/2:black`;
    const label = DRAWTEXT_AVAILABLE ? `,drawtext=text=${tile.id}:fontcolor=white:fontsize=26:box=1:boxcolor=black@0.8:x=8:y=8` : '';
    return `${scaling}${label}[v${i}]`;
  });
  if (tiles.length > 1) {
    const layout = tiles.map((_, i) => `${i % columns * IMAGE_TILE_WIDTH}_${Math.floor(i / columns) * IMAGE_TILE_HEIGHT}`).join('|');
    filters.push(`${tiles.map((_, i) => `[v${i}]`).join('')}xstack=inputs=${tiles.length}:layout=${layout}:fill=black[out]`);
  }
  args.push('-filter_complex', filters.join(';'), '-map', tiles.length === 1 ? '[v0]' : '[out]', '-frames:v', '1', '-update', '1', output);
  call('ffmpeg', args, 120_000);
  if (!existsSync(output) || statSync(output).size === 0) throw new Error('Contact sheet generation failed');
  return output;
}

function groupUnits(units, batchSize) {
  const batches = [];
  let batch = [];
  let tileCount = 0;
  const flush = () => { if (batch.length) batches.push(batch); batch = []; tileCount = 0; };
  for (const unit of units) {
    for (let offset = 0; offset < unit.tiles.length; offset += batchSize) {
      const part = { ...unit, tiles: unit.tiles.slice(offset, offset + batchSize) };
      if (tileCount + part.tiles.length > batchSize) flush();
      batch.push(part);
      tileCount += part.tiles.length;
    }
  }
  flush();
  return batches;
}

function makePrompt(units, { context, prompts }) {
  const rows = units.flatMap(unit => unit.tiles.map(tile => {
    const time = tile.seconds == null ? '' : ` at ${tile.seconds.toFixed(2)} seconds`;
    return `${tile.id} — ${unit.type}, ${unit.filename}${time}${unit.hint ? `; owner's hint: ${unit.hint}` : ''}`;
  })).join('\n');
  const imageGuide = prompts?.get('image-perception') || 'Describe concrete visual content.';
  const videoGuide = prompts?.get('video-perception') || 'Describe observable movement and scene changes.';
  return `Analyze the tiles in the attached contact sheet, in ROW-MAJOR order (left to right, then next row). Up to three columns. Tile IDs T001 etc. follow the exact manifest order below, even if image labels are not visible. They are independent observations, not necessarily a continuous video.\nReturn ONLY a JSON object {"tiles":[{"id":"T001","description":"..."}]} with EXACTLY one entry for each tile ID, no extras. Use the ID printed on each tile. Descriptions must be evidence-based, specific, and concise (one or two sentences). Never infer unobserved motion from still frames, unseen text, personal identity, or precise locations. When content is unreadable, say so.\n\nContext: ${context || '(none)'}\nImage guide: ${imageGuide}\nVideo guide: ${videoGuide}\n\nTile manifest:\n${rows}`;
}

function cacheKey(path, type, hints, context, sampleInterval, promptGuides, size) {
  const stat = statSync(path);
  return createHash('sha256').update(JSON.stringify({ version: MODEL_VERSION, type, path, mtime: stat.mtimeMs, size: stat.size, hints, context, sampleInterval, promptGuides, batchSize: size })).digest('hex').slice(0, 24);
}

function perceptionForUnit(unit, descriptions) {
  if (unit.type === 'image') return {
    desc: descriptions.get(unit.tiles[0].id),
    observations: [{ id: unit.tiles[0].id, mediaId: unit.filename, seconds: null, startSeconds: null, endSeconds: null, description: descriptions.get(unit.tiles[0].id) }],
  };
  const segments = {};
  const observations = [];
  const frames = unit.tiles;
  for (let i = 0; i < frames.length; i++) {
    const start = i === 0 ? 0 : (frames[i - 1].seconds + frames[i].seconds) / 2;
    const end = i === frames.length - 1 ? frames[i].duration : (frames[i].seconds + frames[i + 1].seconds) / 2;
    const startMs = Math.round(start * 1000);
    const endMs = Math.round(end * 1000);
    if (endMs <= startMs) continue;
    segments[`${startMs}to${endMs}`] = { vision: descriptions.get(frames[i].id), sampleSeconds: frames[i].seconds };
    observations.push({ id: frames[i].id, mediaId: unit.filename, seconds: frames[i].seconds, startSeconds: start, endSeconds: end, description: descriptions.get(frames[i].id) });
  }
  const desc = frames.map(tile => `${tile.seconds.toFixed(1)}s: ${descriptions.get(tile.id)}`).join(' ');
  return { desc, segments, observations, subtitle: null };
}

function saveMetadata(path, data) {
  const temp = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify(data, null, 2) + '\n');
    renameSync(temp, path);
  } finally { rmSync(temp, { force: true }); }
}

/**
 * Dependency injection is deliberately limited to runner for hermetic test coverage.
 * A runner owns exactly one WebHelm session, closes it once and never resends an
 * ambiguous submission automatically.
 */
export class DeepSeekSession {
  constructor({ runner = call, sessionId = '' } = {}) {
    this.runner = runner;
    this.sessionId = sessionId;
    this.owned = false;
    this.sessionStartedAt = 0;
  }
  start() {
    if (this.sessionId) return;
    const receipt = JSON.parse(this.runner(WEBHELM, ['session', 'start', '--url', 'https://chat.deepseek.com'], 60_000));
    if (!receipt.session_id) throw new Error('WebHelm session start did not return a session ID');
    this.sessionId = receipt.session_id;
    this.owned = true;
    this.sessionStartedAt = Date.now();
  }
  refreshLease() {
    // Chrome's Browser Workspace extension may reclaim a background tab after
    // five minutes without tab activation, even while its WebHelm session is
    // still active. Rotate leases between batches, never during an upload or
    // an unconfirmed submission. Keep enough room for one 180-second answer.
    if (this.owned && this.sessionId && Date.now() - this.sessionStartedAt >= 60_000) {
      this.close();
      this.start();
    }
  }
  analyze(image, prompt, workDir, timeoutSeconds = 180) {
    const config = join(workDir, 'deepseek-request.json');
    const invoke = (request) => {
      writeFileSync(config, JSON.stringify(request));
      try {
        return this.runner(WEBHELM, ['platform', 'run', 'deepseek', 'understand-image', '--session-id', this.sessionId, '--config', config], (timeoutSeconds + 30) * 1000);
      } catch (error) {
        // WebHelm returns JSON diagnostics on stdout even when it exits nonzero.
        let detail = '';
        try {
          const envelope = JSON.parse(error.stdout || '');
          detail = envelope?.result?.error || envelope?.result?.stderr || '';
        } catch { /* No structured provider receipt. */ }
        throw new Error(`DeepSeek action failed (session ${this.sessionId}): ${(detail || error.message).slice(0, 900)}. Do not resend an uncertain submission.`, { cause: error });
      }
    };
    let response = invoke({ image, prompt, timeout_seconds: timeoutSeconds });
    let receipt;
    try { receipt = decodeReceipt(response); }
    catch (error) { throw new Error(`DeepSeek submission/result uncertain (session ${this.sessionId}): ${error.message}`); }
    // A pending response has an acknowledged thread ID. Resume the same
    // conversation once without re-uploading or submitting the image again.
    if (receipt.status === 'pending' && receipt.thread_id) {
      // Bound the read-only follow-up so one browser lease cannot be silently
      // evicted by the extension's five-minute stale-tab reclaim window.
      response = invoke({ resume: true, thread_id: receipt.thread_id, timeout_seconds: Math.min(timeoutSeconds, 45) });
      receipt = decodeReceipt(response);
    }
    if (receipt.status !== 'completed' || !receipt.answer?.trim()) {
      throw new Error(`DeepSeek result pending or empty (session ${this.sessionId}, thread ${receipt.thread_id || 'unknown'}); no metadata saved.`);
    }
    return receipt.answer;
  }

  close() {
    if (this.owned && this.sessionId) {
      try { this.runner(WEBHELM, ['session', 'stop', this.sessionId], 30_000); }
      finally { this.owned = false; this.sessionId = ''; this.sessionStartedAt = 0; }
    }
  }
}

export { createContactSheet, groupUnits, makePrompt, parseTileAnswer, parseReceipt, sampleVideo };
