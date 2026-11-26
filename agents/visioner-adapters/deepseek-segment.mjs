#!/usr/bin/env node
// Text-only semantic segmentation through the existing DeepSeek lifecycle.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DeepSeekSession } from './webhelm-deepseek.mjs';

export function segment(prompt, session = new DeepSeekSession()) {
  if (typeof prompt !== 'string' || !prompt.trim()) throw Error('Segmentation prompt required');
  const dir = mkdtempSync(join(tmpdir(), 'neo-vision-segment-'));
  try {
    session.start();
    const answer = session.completeText(prompt, dir);
    const text = answer.trim().replace(/^\x60\x60\x60(?:json)?\s*/i, '').replace(/\s*\x60\x60\x60$/, '');
    let data;
    try { data = JSON.parse(text); } catch { throw Error('DeepSeek segmentation did not return valid JSON'); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error('DeepSeek segmentation must return a JSON object');
    // Markcut remains authoritative for range coverage and instruction validation.
    return JSON.stringify(data);
  } finally {
    try { session.close(); } finally { rmSync(dir, { recursive: true, force: true }); }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== '--prompt') throw Error('Usage: deepseek-segment.mjs --prompt TEXT');
    process.stdout.write(segment(process.argv[3]) + '\n');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
