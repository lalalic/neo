import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { isAudioAttachment, transcribeAudioAttachments } from '../src/asr.mjs';

test('local ASR downloads audio once and calls uvx without remote ASR',async()=>{
  const urls=[];
  const calls=[];
  const fetchImpl=async url=>{
    urls.push(url);
    return new Response(Buffer.from('audio-bytes'),{status:200});
  };
  const run=async(bin,args)=>{
    calls.push({bin,args});
    assert.equal(bin,'uvx');
    const output=args[args.indexOf('--output-path')+1];
    await fs.writeFile(`${output}.txt`,'Local transcript');
  };
  const result=await transcribeAudioAttachments([
    {url:'https://cdn.example/voice.ogg',name:'voice.ogg',mimeType:'audio/ogg',size:11}
  ],{fetchImpl,run,env:{}});
  assert.equal(result,'Local transcript');
  assert.deepEqual(urls,['https://cdn.example/voice.ogg']);
  assert.equal(calls.length,1);
  assert.equal(calls[0].args.includes('mlx_audio.stt.generate'),true);
});
test('audio classification ignores nonaudio attachments',()=>{
  assert.equal(isAudioAttachment({name:'voice.m4a'}),true);
  assert.equal(isAudioAttachment({name:'worksheet.pdf'}),false);
});
