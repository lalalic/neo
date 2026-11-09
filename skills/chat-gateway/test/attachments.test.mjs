import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createAttachmentStore } from '../core/attachments.mjs';
import { fixture } from './helpers.mjs';
import { readFile } from 'node:fs/promises';

test('chunked binary uploads persist original bytes and verify references', async t => {
  const { dir } = await fixture(t);
  const store = createAttachmentStore({ root: dir });
  const data = Buffer.from([0,1,255,128,65,0,66,15,255]);
  const sha256 = createHash('sha256').update(data).digest('hex');
  const input = { requestId: 'owner-attachment-1234', attachmentId: 'asset-12345678',
    name: 'sample.png', chunkCount: 2, sha256, size: data.length };
  const first = { ...input, chunkIndex: 0, contentBase64: data.subarray(0,5).toString('base64') };
  const second = { ...input, chunkIndex: 1, contentBase64: data.subarray(5).toString('base64') };
  assert.equal((await store.upload(first)).complete,false);
  await store.upload(first);
  assert.equal((await store.upload(second)).complete,true);
  const paths = await store.resolve(input.requestId,[{id:input.attachmentId,name:'sample.png'}]);
  assert.deepEqual(await readFile(paths[0]),data);
  await assert.rejects(store.upload({...first,contentBase64:Buffer.from('bad').toString('base64')}),/collision/);
  await assert.rejects(store.resolve(input.requestId,[{id:input.attachmentId,name:'../sample.png'}]),/reference/);
});

test('invalid chunk names and checksum are rejected', async t => {
  const {dir} = await fixture(t);
  const store=createAttachmentStore({root:dir});
  const data=Buffer.from('abc');
  const body={ requestId:'req-12345678',attachmentId:'asset-12345678',name:'picture.png',
    chunkIndex:0,chunkCount:1,contentBase64:data.toString('base64'),
    size:3,sha256:'0'.repeat(64) };
  await assert.rejects(store.upload(body),/checksum/);
  await assert.rejects(store.upload({...body,name:'../escape'}),/Invalid attachment/);
});
