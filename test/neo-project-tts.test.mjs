import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,existsSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {parseTtsArgs,runTts} from '../.bin/neo-project-tts.mjs';
const neo=new URL('../.bin/neo.mjs',import.meta.url).pathname;
function fixture(t){const root=mkdtempSync(join(tmpdir(),'neo-shared-tts-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return root;}

test('shared CLI synthesizes real Chinese M4A with verified audio stream',t=>{
 const root=fixture(t),out=join(root,'speech.m4a');
 const response=JSON.parse(execFileSync(process.execPath,[neo,'project','tts','--text','今天阳光很好，我们一起看看水面的波纹。','--output',out],{encoding:'utf8'}));
 assert.equal(response.status,'PASS'); assert.equal(response.output,out);assert.equal(response.voice,'Tingting');assert.ok(response.durationSeconds>1);
 assert.ok(statSync(out).size>2048);
 const ffprobe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','format=duration:stream=codec_type','-of','json',out],{encoding:'utf8'}));
 assert.ok(ffprobe.streams.some(s=>s.codec_type==='audio'));
 assert.ok(Number(ffprobe.format.duration)>1);
});
test('shared CLI accepts narration file, voice and speaking rate, produces WAV',t=>{
 const root=fixture(t),out=join(root,'nested','speech.wav'),input=join(root,'narration.txt');
 writeFileSync(input,'石头边的溪水慢慢向前流，风吹过来，树叶也动了。');
 const response=JSON.parse(execFileSync(process.execPath,[neo,'project','tts','--text-file',input,'--output',out,'--voice','Tingting','--rate','225'],{encoding:'utf8'}));
 assert.equal(response.status,'PASS'); assert.equal(response.format,'wav');assert.ok(response.durationSeconds>1);
 assert.ok(existsSync(out));
});
test('rejects invalid inputs and nonlocal nodes before touching output',t=>{
 const root=fixture(t),out=join(root,'speech.m4a');
 for(const args of [
  ['--text','hello'],
  ['--text','', '--output',out],
  ['--text','hello','--text-file','anything','--output',out],
  ['--text','hello','--output','relative.m4a'],
  ['--text','hello','--output',out,'--node','work'],
  ['--text','hello','--output',out,'--rate','500'],
 ]) assert.throws(()=>parseTtsArgs(args));
 assert.equal(existsSync(out),false);
});
test('existing output is preserved and engine errors do not leave partial artifacts',t=>{
 const root=fixture(t),out=join(root,'speech.m4a');writeFileSync(out,'SENTINEL');
 assert.throws(()=>runTts(['--text','你好','--output',out]),/refusing to overwrite/);
 assert.equal(execFileSync('cat',[out],{encoding:'utf8'}),'SENTINEL');
 const alt=join(root,'second.m4a');
 assert.throws(()=>runTts(['--text','你好','--output',alt],{run(){throw Error('engine unavailable');}}),/engine unavailable/);
 assert.equal(existsSync(alt),false);
});
