import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const neo=dirname(dirname(fileURLToPath(import.meta.url)));
const file=(name)=>readFileSync(join(neo,'agents',name+'.agent.md'),'utf8');
test('Neo exposes standalone reusable Visioner, Editor and Publisher Agents',()=>{
 for(const name of ['visioner','editor','publisher']){
  assert.ok(existsSync(join(neo,'agents',name+'.agent.md')));
  assert.match(file(name),new RegExp('^name: '+name+'$','m'));
  assert.doesNotMatch(file(name),/^extends:/m,'shared role must not itself extend an external base');
 }
});
test('Editor makes cinematic decisions and shares real Markcut Editor Decisions instead of hidden reasoning',()=>{
 const editor=file('editor');
 for(const term of ['shot grammar','montage','sound','source','video.edl.json','editor_reason','visual_relationship','sound_decision','markcut verify','Editor Decisions'])
  assert.ok(editor.includes(term),term);
 assert.match(editor,/not.*private internal chain-of-thought/i);
 const contract=readFileSync(join(neo,'skills/neo-project/references/project-contract.md'),'utf8');
 assert.match(contract,/extends: shared\/editor/);
 assert.match(contract,/extends: shared\/publisher/);
 assert.match(contract,/extends: shared\/visioner/);
});
