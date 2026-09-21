import test from 'node:test';
import assert from 'node:assert/strict';
import { buildParentContextPrompt, buildSlashStatusPrompt, canUseStatus, findChild, formatSlashOverview, formatSlashStatus, isAuthorizedParent, parseParentCommand, parseParentMessage, statusCommand, statusDenialMessage } from '../src/parent-context.mjs';

const config={parents:[{id:'p1',role:'parent'}]};
const child={id:'sammy',name:'Sammy',discordChannelId:'111'};
const children=[child,{id:'maggie',name:'Maggie',discordChannelId:'222'}];
const statusConfig={...config,discord:{parentChannelId:'parent-channel'}};

test('authorizes only configured parent accounts',()=>{
  assert.equal(isAuthorizedParent({author:{id:'p1'}},config),true);
  assert.equal(isAuthorizedParent({author:{id:'child'}},config),false);
});

test('parses named-child parent commands',()=>{
  assert.deepEqual(parseParentCommand('!status sammy How is math going?'),{command:'!status',childId:'sammy',value:'How is math going?'});
  assert.deepEqual(parseParentCommand('!guide sammy Practice fractions twice this week'),{command:'!guide',childId:'sammy',value:'Practice fractions twice this week'});
});

test('routes natural parent messages by configured Discord channel mention anywhere in the sentence',()=>{
  assert.deepEqual(parseParentMessage("how's <#111>'s recent status?",children),{command:'parent-query',childId:'sammy',value:"how's Sammy's recent status?"});
  assert.deepEqual(parseParentMessage('please have <#222> review fractions tonight',children),{command:'parent-query',childId:'maggie',value:'please have Maggie review fractions tonight'});
  assert.deepEqual(parseParentMessage('<#111> has a chemistry test Friday—focus on practice problems',children),{command:'parent-query',childId:'sammy',value:'Sammy has a chemistry test Friday—focus on practice problems'});
});

test('does not route unconfigured, ambiguous, or mention-only parent messages',()=>{
  assert.equal(parseParentMessage('please check <#999>',children),null);
  assert.equal(parseParentMessage('check <#111> and <#222>',children),null);
  assert.equal(parseParentMessage('<#111>',children),null);
});

test('tags parent context and privacy-filters status requests',()=>{
  const prompt=buildParentContextPrompt({child,command:'!status',value:'How is math going?',authorId:'p1',messageId:'m1'});
  assert.match(prompt,/source=discord-parent type=status-question author=p1 message=m1/);
  assert.match(prompt,/not written by the child/);
  assert.match(prompt,/existing persistent tutor thread/);
  assert.match(prompt,/privacy-filtered learning summary/);
  assert.match(prompt,/Do not include casual conversation/);
});

test('passes natural parent intent through the existing privacy-filtered context prompt',()=>{
  const prompt=buildParentContextPrompt({child,command:'parent-query',value:"how's Sammy's recent status?",authorId:'p1',messageId:'m2'});
  assert.match(prompt,/type=status-question/);
  assert.match(prompt,/Parent message: how's Sammy's recent status\?/);
  assert.match(prompt,/existing persistent tutor thread/);
});

test('resolves slash child by id or display name',()=>{
  assert.equal(findChild(children,'SAMMY'),child);
  assert.equal(findChild(children,'Maggie'),children[1]);
  assert.equal(findChild(children,'unknown'),null);
});

test('allows status only for an authorized parent in the configured channel',()=>{
  assert.equal(canUseStatus({channelId:'parent-channel',userId:'p1'},statusConfig),true);
  assert.equal(canUseStatus({channelId:'child-channel',userId:'p1'},statusConfig),false);
  assert.equal(canUseStatus({channelId:'parent-channel',userId:'child'},statusConfig),false);
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
