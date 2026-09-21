import test from 'node:test';
import assert from 'node:assert/strict';
import { buildParentContextPrompt, buildSlashStatusPrompt, canUseStatus, childProjectName, findChildByChannelName, formatSlashOverview, formatSlashStatus, isAuthorizedParent, parseParentCommand, parseParentMessage, statusCommand, statusDenialMessage, validateChildChannel, renderParentNaturalText } from '../src/parent-context.mjs';

const config={parents:[{id:'p1',role:'parent'}]};
const child={id:'sammy',name:'Sammy'};
const children=[child,{id:'maggie',name:'Maggie'}];
const statusConfig={...config,discord:{parentChannelId:'parent-channel'}};

test('authorizes only configured parent accounts',()=>{
  assert.equal(isAuthorizedParent({author:{id:'p1'}},config),true);
  assert.equal(isAuthorizedParent({author:{id:'child'}},config),false);
});

test('parses command syntax without making it a routing decision',()=>{
  assert.deepEqual(parseParentCommand('!status sammy How is math going?'),{command:'!status',childId:'sammy',value:'How is math going?'});
  assert.deepEqual(parseParentCommand('!guide sammy Practice fractions twice this week'),{command:'!guide',childId:'sammy',value:'Practice fractions twice this week'});
});

test('routes natural parent messages by configured Discord channel mention anywhere in the sentence',()=>{
  const status=parseParentMessage("how's <#111>'s recent status?",children);
  assert.deepEqual(status,{command:'parent-query',channelMentionId:'111',value:"how's <#111>'s recent status?"});
  assert.equal(renderParentNaturalText(status.value,'111','Sammy'),"how's Sammy's recent status?");
  const guidance=parseParentMessage('please have <#222> review fractions tonight',children);
  assert.equal(renderParentNaturalText(guidance.value,'222','Maggie'),'please have Maggie review fractions tonight');
  const test=parseParentMessage('<#111> has a chemistry test Friday—focus on practice problems',children);
  assert.equal(renderParentNaturalText(test.value,'111','Sammy'),'Sammy has a chemistry test Friday—focus on practice problems');
});

test('preserves punctuation around a mid-sentence mention',()=>{
  const parsed=parseParentMessage('Could <#222>, please review fractions tonight?',children);
  assert.deepEqual(parsed,{command:'parent-query',channelMentionId:'222',value:'Could <#222>, please review fractions tonight?'});
  assert.equal(renderParentNaturalText(parsed.value,'222','Maggie'),'Could Maggie, please review fractions tonight?');
});

test('routes command-style parent messages by the mention, never by the child name',()=>{
  assert.deepEqual(parseParentMessage('!focus <#222> fractions tonight',children),{command:'!focus',channelMentionId:'222',value:'fractions tonight'});
  assert.deepEqual(parseParentMessage('!status sammy How is math going?',children),{command:'!status',value:'How is math going?'});
});

test('does not route unconfigured, ambiguous, or mention-only parent messages',()=>{
  assert.deepEqual(parseParentMessage('please check <#999>',children),{command:'parent-query',channelMentionId:'999',value:'please check <#999>'});
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

test('resolves slash child by exact configured channel id',()=>{
  assert.equal(findChildByChannelName(children,'sammy'),child);
  assert.equal(findChildByChannelName(children,'SAMMY'),null);
  assert.equal(findChildByChannelName(children,'unknown'),null);
  assert.equal(childProjectName('sammy'),'neo/family-tutor/sammy');
  assert.deepEqual(validateChildChannel(child,{name:'sammy'}),{childId:'sammy',project:'neo/family-tutor/sammy'});
  assert.throws(()=>validateChildChannel(child,{name:'Sammy'}),/must match child id\/project suffix sammy/);
});

test('classifies natural status questions and assignments separately',()=>{
  const status=buildParentContextPrompt({child,command:'parent-query',value:"how's Sammy's recent status?",authorId:'p1',messageId:'m3'});
  const guidance=buildParentContextPrompt({child,command:'parent-query',value:'please have Maggie review fractions tonight',authorId:'p1',messageId:'m4'});
  assert.match(status,/type=status-question/);
  assert.match(guidance,/type=guidance-assignment/);
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
