import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

const ID = /^[A-Za-z0-9_-]{8,128}$/;
const MAX_CHUNK_BYTES = 128 * 1024;
const MAX_FILE_BYTES = 12 * 1024 * 1024;

function validName(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 120 &&
    basename(value) === value && !/[/\\\x00-\x1f]/.test(value) &&
    value !== '.' && value !== '..' && !value.startsWith('.');
}

export function createAttachmentStore({ root }) {
  const location = (requestId, attachmentId) =>
    join(root, 'attachments', requestId, attachmentId);

  async function upload({ requestId, attachmentId, name, chunkIndex, chunkCount,
    contentBase64, sha256, size }) {
    if (!ID.test(requestId ?? '') || !ID.test(attachmentId ?? '') || !validName(name) ||
        !Number.isInteger(size) || size <= 0 || size > MAX_FILE_BYTES ||
        typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256) ||
        !Number.isInteger(chunkCount) || chunkCount < 1 || chunkCount > 96 ||
        !Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= chunkCount ||
        typeof contentBase64 !== 'string' || contentBase64.length > 175_000 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(contentBase64)) {
      throw Error('Invalid attachment chunk metadata');
    }
    const bytes = Buffer.from(contentBase64, 'base64');
    if (!bytes.length || bytes.length > MAX_CHUNK_BYTES ||
        bytes.toString('base64') !== contentBase64) throw Error('Invalid attachment bytes');

    const dir = location(requestId, attachmentId);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const part = join(dir, String(chunkIndex).padStart(4, '0') + '.part');
    const metaFile = join(dir, 'manifest.json');
    const meta = { requestId, attachmentId, name, chunkCount, size, sha256 };
    const existingMeta = await readFile(metaFile, 'utf8').catch(() => null);
    if (existingMeta && existingMeta !== JSON.stringify(meta)) {
      throw Error('Attachment ID already belongs to different content');
    }
    if (!existingMeta) await writeFile(metaFile, JSON.stringify(meta), { mode: 0o600, flag: 'wx' })
      .catch(async e => { if (e.code !== 'EEXIST' || await readFile(metaFile, 'utf8') !== JSON.stringify(meta)) throw e; });
    const existing = await readFile(part).catch(() => null);
    if (existing) {
      if (!existing.equals(bytes)) throw Error('Attachment chunk collision');
    } else {
      await writeFile(part, bytes, { flag: 'wx', mode: 0o600 }).catch(async e => {
        if (e.code !== 'EEXIST' || !(await readFile(part)).equals(bytes)) throw e;
      });
    }
    const filePath = join(dir, name);
    if (await stat(filePath).catch(() => null)) return { attachmentId, complete: true };
    const chunks = [];
    for (let i = 0; i < chunkCount; i++) {
      const piece = await readFile(join(dir, String(i).padStart(4, '0') + '.part')).catch(() => null);
      if (!piece) return { attachmentId, complete: false };
      chunks.push(piece);
    }
    const complete = Buffer.concat(chunks);
    if (complete.length !== size || createHash('sha256').update(complete).digest('hex') !== sha256) {
      throw Error('Attachment size or checksum mismatch');
    }
    const tmp = join(dir, '.complete.tmp');
    await writeFile(tmp, complete, { mode: 0o600 });
    await rename(tmp, filePath);
    return { attachmentId, complete: true };
  }

  async function resolve(requestId, refs = []) {
    if (!ID.test(requestId ?? '') || !Array.isArray(refs) || refs.length > 4) {
      throw Error('Invalid attachment references');
    }
    const paths = [];
    for (const ref of refs) {
      if (!ref || !ID.test(ref.id ?? '') || !validName(ref.name)) throw Error('Invalid attachment reference');
      const dir = location(requestId, ref.id);
      const meta = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
      if (meta.requestId !== requestId || meta.attachmentId !== ref.id ||
          meta.name !== ref.name) throw Error('Attachment reference mismatch');
      const path = join(dir, meta.name);
      const file = await readFile(path);
      if (file.length !== meta.size ||
          createHash('sha256').update(file).digest('hex') !== meta.sha256) {
        throw Error('Attachment not yet complete or corrupted');
      }
      paths.push(path);
    }
    return paths;
  }
  return { upload, resolve };
}
