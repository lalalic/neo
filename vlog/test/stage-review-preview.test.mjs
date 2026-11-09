import test from 'node:test';
import assert from 'node:assert/strict';
import {guideCard,mediaNode,quote} from '../lib/review-markcut.mjs';
import {pillars,validateHookFocus} from '../scripts/director-hooks-to-md.mjs';

// Stage Review uses standard Markcut Components, not a new review schema.
test('Director Guide displays recommendation and safe literal text in Markcut JSX',()=>{
 const card=guideCard({title:'人物 <故事>',guide:'发现红果后往嘴边送了一颗',recommended:true});
 assert.match(card,/★ Director 推荐/);
 assert.match(card,/~~~jsx/);
 assert.match(card,/\\u003c故事\\u003e/);
 assert.match(card,/fontSize:30/);
 assert.doesNotMatch(card,/<故事>/);
});

test('Source-bound Review uses original footage proxies without a new edit contract',()=>{
 assert.equal(mediaNode({type:'video',path:'assets/review/visioner/source-013.mp4',duration:12.2}),
   '- video src:assets/review/visioner/source-013.mp4 duration:12.2 volume:1 fit:contain');
 assert.equal(mediaNode({type:'image',path:'assets/review/visioner/source-001.jpg',duration:3}),
   '- image src:assets/review/visioner/source-001.jpg duration:3 fit:contain');
 assert.equal(quote('Hook A\nGo'), '"Hook A Go"');
});


test('each Director Hook has one of the six channel directions and a viewer reason',()=>{
 assert.equal(Object.keys(pillars).length,6);
 const hook={id:'walk',primary_pillar:'travel_explore',viewer_reason:'对加拿大普通街头散步生活好奇的中国观众',media:[{source_id:'013',start_seconds:0,end_seconds:5}]};
 assert.equal(validateHookFocus(hook,'travel_explore'),'加国旅探 / 生活');
 assert.throws(()=>validateHookFocus({...hook,primary_pillar:'scenery'}),/six channel.md pillars/);
 assert.throws(()=>validateHookFocus({...hook,viewer_reason:'好看'}),/viewer reason/);
 assert.throws(()=>validateHookFocus(hook,'ai'),/match selected episode primary/);
 assert.throws(()=>validateHookFocus({...hook,media:[]}),/real source/);
});
