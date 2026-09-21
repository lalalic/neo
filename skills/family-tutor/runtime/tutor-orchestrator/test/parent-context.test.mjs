import test from 'node:test';
import assert from 'node:assert/strict';
import { buildParentContextPrompt, buildSlashStatusPrompt, findChild, formatSlashOverview, formatSlashStatus, isAuthorizedParent, parseParentCommand, statusCommand, statusDenialMessage } from '../src/parent-context.mjs';

const config={parents:[{id:'p1',role:'parent'}]};
const child={id:'sammy',name:'Sammy'};
const children=[child,{id:'maggie',name:'Maggie'}];

test('authorizes only configured parent accounts',()=>{
  assert.equal(isAuthorizedParent({author:{id:'p1'}},config),true);
  assert.equal(isAuthorizedParent({author:{id:'child'}},config),false);
});

test('parses named-child parent commands',()=>{
  assert.deepEqual(parseParentCommand('!status sammy How is math going?'),{command:'!status',childId:'sammy',value:'How is math going?'});
  assert.deepEqual(parseParentCommand('!guide sammy Practice fractions twice this week'),{command:'!guide',childId:'sammy',value:'Practice fractions twice this week'});
});

test('tags parent context and privacy-filters status requests',()=>{
  const prompt=buildParentContextPrompt({child,command:'!status',value:'How is math going?',authorId:'p1',messageId:'m1'});
  assert.match(prompt,/source=discord-parent type=status-question author=p1 message=m1/);
  assert.match(prompt,/not written by the child/);
  assert.match(prompt,/existing persistent tutor thread/);
  assert.match(prompt,/privacy-filtered learning summary/);
  assert.match(prompt,/Do not include casual conversation/);
});

test('resolves slash child by id or display name',()=>{
  assert.equal(findChild(children,'SAMMY'),child);
  assert.equal(findChild(children,'Maggie'),children[1]);
  assert.equal(findChild(children,'unknown'),null);
});

test('builds read-only status prompt with learner context and privacy rules',()=>{
  const prompt=buildSlashStatusPrompt({child,memory:'# Memory\n- Fractions are improving.'});
  assert.match(prompt,/existing child Project\/thread/);
  assert.match(prompt,/Fractions are improving/);
  assert.match(prompt,/Do not quote or summarize private conversation/);
  assert.match(prompt,/do not emit control markers/);
});

test('formats privacy-filtered status and compact overview',()=>{
  const status=formatSlashStatus(child,'Recent topic: fractions\nProgress: equivalent fractions\n<FAMILY_TUTOR_MEMORY>secret</FAMILY_TUTOR_MEMORY>\nNext: practice');
  assert.equal(status,'**Sammy**\nRecent topic: fractions\nProgress: equivalent fractions\nNext: practice');
  assert.equal(formatSlashOverview([status,'**Maggie**\nNo recent learning signal.']),`${status}\n\n**Maggie**\nNo recent learning signal.`);
  assert.equal(statusCommand.name,'status');
  assert.match(statusDenialMessage(),/parent control channel/);
});
