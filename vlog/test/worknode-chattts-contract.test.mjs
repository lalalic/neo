import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('owner Vlog narration uses male ChatTTS inference on Worknode, not Tingting on Neo Master',()=>{
  const editor=readFileSync(new URL('../agents/vlog-editor.agent.md',import.meta.url),'utf8');
  assert.match(editor,/male ChatTTS on Worknode/);
  assert.match(editor,/OpenVoice V2/);
  assert.match(editor,/TTS inference on Worknode, not Neo Master/);
  assert.match(editor,/silently fall back/);
  assert.match(editor,/noncommercial/);
});
test('cinematic Vlog BGM root gain is 0.7 in the canonical template',()=>{
  const template=readFileSync(new URL('../templates/cinematic-vlog.md',import.meta.url),'utf8');
  const matched=template.match(/<!-- VLOG:CONFIG\s*([\s\S]*?)\s*VLOG:END_CONFIG -->/);
  assert.ok(matched,'canonical template config missing');
  const config=JSON.parse(matched[1]);
  assert.equal(config.audio.bgm_plain_volume,0.7);
  assert.equal(config.audio.bgm_preducked_volume,0.7);
});

test('private no-cloning Vlogs use Worknode male ChatTTS without OpenVoice conversion',()=>{
  const editor=readFileSync(new URL('../agents/vlog-editor.agent.md',import.meta.url),'utf8');
  const contract=readFileSync(new URL('../docs/episode-stage-contract.md',import.meta.url),'utf8');
  assert.match(editor,/If the Run forbids voice cloning, use[\s\S]*?unconverted male ChatTTS/);
  assert.match(editor,/do not load, sample or clone any[\s\S]*?voice reference/);
  assert.match(contract,/If the Run[\s\S]*?forbids voice cloning, use unconverted generic male ChatTTS/);
});
