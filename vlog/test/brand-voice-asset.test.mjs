import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,statSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=resolve(import.meta.dirname,'..');

test('Brand TTS is an actual decodable Worknode-generated audio artifact with verified hash',()=>{
 const path=join(root,'assets/brand/brand-intro-voice.mp3');
 assert.ok(existsSync(path));
 assert.ok(statSync(path).size>10000);
 const sha=createHash('sha256').update(readFileSync(path)).digest('hex');
 assert.equal(sha,'a655c565147797f7d90803088fa6293ba73b78369ced040638e212210752ef67');
 const check=spawnSync('ffprobe',['-v','error','-show_entries','format=duration:stream=codec_type,sample_rate','-of','json',path],{encoding:'utf8',timeout:20000});
 assert.equal(check.status,0,check.stderr);
 const info=JSON.parse(check.stdout);
 assert.equal(info.streams[0].codec_type,'audio');
 assert.equal(info.streams[0].sample_rate,'44100');
 assert.ok(+info.format.duration>=1.7 && +info.format.duration<=2.5);
});

test('Content-selected male voices are explicit Worknode profiles; no user voice clone requested',()=>{
 const config=JSON.parse(readFileSync(join(root,'config/tour-voice-profiles.json'),'utf8'));
 assert.equal(config.model,'mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-6bit');
 assert.deepEqual(Object.keys(config.voices),['pv13','pv14','pv16','pv17','pv18']);
 assert.equal(config.voices.pv13.voice,'Uncle_Fu');
 assert.equal(config.voices.pv14.voice,'Dylan');
 assert.equal(config.voices.pv16.voice,'Eric');
 assert.equal(config.voices.pv17.voice,'Eric');
 assert.equal(config.voices.pv18.voice,'Uncle_Fu');
});
