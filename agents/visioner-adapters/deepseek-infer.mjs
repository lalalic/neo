#!/usr/bin/env node
/**
 * WebHelm DeepSeek as a generic Markcut --itt/--vtt CLI executor.
 * Returns source-grounded visual prose, leaving STT and segmentation to Markcut.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename, extname } from 'node:path';
import { IMAGE_EXTS, VIDEO_EXTS } from './media-types.mjs';
import { createContactSheet, groupUnits, makePrompt, parseTileAnswer, sampleVideo, DeepSeekSession } from './webhelm-deepseek.mjs';

export function parseDeepSeekInferArgs(args) {
  const options = { prompt: '', inputs: [], sampleInterval: 5, batchSize: 8 };
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (key === '--prompt' && args[i + 1]) options.prompt = args[++i];
    else if (key === '--input' && args[i + 1]) options.inputs.push(args[++i]);
    else if (key === '--sample-interval' && args[i + 1]) options.sampleInterval = Number(args[++i]);
    else if (key === '--batch-size' && args[i + 1]) options.batchSize = Number(args[++i]);
    else if (key === '--help') return { help: true };
    else if (key && !key.startsWith('--')) options.inputs.push(key.startsWith('@') ? key.slice(1) : key);
    else throw new Error('Unknown or incomplete argument: ' + key);
  }
  if (!options.inputs.length) throw new Error('DeepSeek inference requires --input path(s)');
  if (!Number.isFinite(options.sampleInterval) || options.sampleInterval <= 0) throw new Error('Invalid --sample-interval');
  if (!Number.isInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > 12) throw new Error('Invalid --batch-size');
  return options;
}

export function inferDeepSeekVisual({ inputs, prompt = '', sampleInterval = 5, batchSize = 8, session = null }) {
  const dir = mkdtempSync(join(tmpdir(), 'markcut-deepseek-hook-'));
  const browser = session || new DeepSeekSession();
  const units = [];
  let tileId = 1;
  try {
    for (const path of inputs) {
      const extension = extname(path).toLowerCase();
      const type = VIDEO_EXTS.has(extension) ? 'video' : IMAGE_EXTS.has(extension) ? 'image' : null;
      if (!type) throw new Error('Unsupported ITT/VTT media type: ' + basename(path));
      const frames = type === 'video'
        ? sampleVideo(path, dir, { maxFrames: 72, sampleInterval })
        : [{ path, seconds: null }];
      units.push({
        filename: basename(path), type, path, hint: '',
        tiles: frames.map(frame => ({ ...frame, id: 'T' + String(tileId++).padStart(3, '0') })),
      });
    }
    const descriptions = new Map();
    browser.start();
    for (const [index, batch] of groupUnits(units, batchSize).entries()) {
      const tiles = batch.flatMap(unit => unit.tiles);
      const sheet = createContactSheet(tiles, join(dir, 'contact-' + index + '.jpg'));
      if (typeof browser.refreshLease === 'function') browser.refreshLease();
      const answer = browser.analyze(sheet, makePrompt(batch, { context: prompt }), dir);
      for (const [id, description] of parseTileAnswer(answer, tiles)) descriptions.set(id, description);
    }
    const passages = units.map(unit => {
      const lines = unit.tiles.map(tile => {
        const caption = descriptions.get(tile.id);
        if (!caption) throw new Error('Missing frame description for tile ' + tile.id);
        return tile.seconds == null ? caption : tile.seconds.toFixed(2) + 's: ' + caption;
      });
      return unit.filename + ': ' + lines.join(' ');
    });
    return passages.join('\n');
  } finally {
    if (!session) browser.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
const isDirect = process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href;
if (isDirect) {
  try {
    const args = parseDeepSeekInferArgs(process.argv.slice(2));
    if (args.help) {
      process.stdout.write('Usage: node deepseek-infer.mjs --prompt TEXT --input MEDIA [--input MEDIA...] [--sample-interval N] [--batch-size N]\n');
    } else {
      process.stdout.write(inferDeepSeekVisual(args) + '\n');
    }
  } catch (error) {
    process.stderr.write('DeepSeek ITT/VTT failed: ' + error.message + '\n');
    process.exitCode = 1;
  }
}
