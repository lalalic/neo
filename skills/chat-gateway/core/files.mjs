import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const FILE_MODE = 0o600;
const DIR_MODE = 0o700;

export async function ensureDir(dir) {
  await mkdir(dir, { recursive: true, mode: DIR_MODE });
}

/** Read a JSON file; return the fallback when it is missing or unreadable. */
export async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}

/** Write JSON atomically (temp file, then rename) with private permissions. */
export async function writeJsonAtomic(path, value) {
  await ensureDir(dirname(path));
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: FILE_MODE });
  await rename(temp, path);
}

export const files = Object.freeze({ readJson, writeJsonAtomic, ensureDir });
