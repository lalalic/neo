import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCinematicTemplate } from '../lib/cinematic-vlog.mjs';

test('owner Vlog narration uses male ChatTTS inference on Worknode, not Tingting on Neo Master',()=>{
  const editor=readFileSync(new URL('../agents/vlog-editor.agent.md',import.meta.url),'utf8');
  assert.match(editor,/male ChatTTS on Worknode/);
  assert.match(editor,/OpenVoice V2/);
  assert.match(editor,/TTS inference on Worknode, not Neo Master/);
  assert.match(editor,/silently fall back/);
  assert.match(editor,/noncommercial/);
});
test('cinematic Vlog BGM root gain is 0.7 in the canonical template',()=>{
  const {config}=parseCinematicTemplate();
  assert.equal(config.audio.bgm_plain_volume,0.7);
  assert.equal(config.audio.bgm_preducked_volume,0.7);
});
