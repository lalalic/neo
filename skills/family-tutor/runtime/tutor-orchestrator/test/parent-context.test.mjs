import test from 'node:test';
import assert from 'node:assert/strict';
import { buildParentContextPrompt, isAuthorizedParent, parseParentCommand } from '../src/parent-context.mjs';

const config={parents:[{id:'p1',role:'parent'}]};
const child={id:'sammy',name:'Sammy'};

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
