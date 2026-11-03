import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read = path => readFileSync(new URL(`../${path}`,import.meta.url), 'utf8');
test('one creative strategy library referenced by human and producing roles',()=>{
  const doc=read('templates/creative-strategies.md');
  assert.match(read('README.md'), /templates\/creative-strategies\.md/);
  for(const role of ['distribution-editor']){
    assert.match(read(`agents/${role}.agent.md`), /templates\/creative-strategies\.md/,role);
  }
  for(const category of ['Confrontation','Empathy','Viewer-as-commentator','Personal voice reaction']) assert.match(doc,new RegExp(category));
});
test('commentary lane and misleading hooks fail closed',()=>{
  const doc=read('templates/creative-strategies.md');
  assert.match(doc,/re-dub\/narrate\/spoil without prior consent/i);
  assert.match(doc,/written provider authorization/i);
  assert.match(doc,/as a guaranteed viral formula/i);
  assert.match(doc,/DEVICE_LIMIT/);
  assert.match(doc,/direct XHS note/i);
  assert.match(doc,/No evidence this editing method improves drama audience retention/);
});

test('XHS creator research cites original notes and rejects unlicensed narration',()=>{
  const s=read('templates/creative-strategies.md');
  const d=read('docs/research/xhs-hooks-2026-11-02.md');
  assert.match(s,/docs\/research\/xhs-hooks-2026-11-02\.md/);
  for(const id of ['6ace2aca00000000150103f8','6a97f846000000002b01ddda','6ad1e6a9000000001a0255e5','6ae80c7a000000001a022d33'])
    assert.ok(d.includes(id), id);
  assert.match(d,/Do not adopt subtitle rewriting/);
  assert.match(d,/Script-only HOLD/);
  assert.match(d,/our.*proposed.*test structure/);
});
