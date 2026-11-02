import test from 'node:test';
import assert from 'node:assert/strict';
import {assertStoryPlan,assertAudiovisualStory} from '../lib/story-plan.mjs';
const input={scenes:[{id:'hook'},{id:'road'},{id:'payoff'}],story:{goal:'Find the trail to the lake',outcome:'We reached the lake after an unexpected detour',evidenceRef:'story.md#owner-confirmed',progression:[{sceneId:'hook',purpose:'hook and goal'},{sceneId:'road',purpose:'detour conflict'},{sceneId:'payoff',purpose:'outcome'}]}};
test('Director narrative determines sequence before production',()=>{
 assert.deepEqual(assertStoryPlan(input).sourceSceneIds,['hook','road','payoff']);
});
test('compilation must not silently convert media-only uploads into a story',()=>{
 assert.throws(()=>assertStoryPlan({scenes:input.scenes}),/STORY_FIRST_REQUIRED/);
 assert.throws(()=>assertStoryPlan({...input,story:{...input.story,progression:input.story.progression.slice(0,2)}}),/STORY_CONTINUITY_REQUIRED/);
 assert.throws(()=>assertStoryPlan({...input,story:{...input.story,progression:[input.story.progression[0],input.story.progression[2],input.story.progression[1]]}}),/STORY_CONTINUITY_REQUIRED/);
});

const verifiedDelivery=(sceneId,mode='source-speech')=>({sceneId,purpose:sceneId,delivery:mode==='source-speech'
 ? {mode, listeningVerified:true,evidenceRef:'synthetic listened source clip'}
 : {mode,evidenceRef:'synthetic visuals'}});
test('story first requires real spoken beats and cannot pass on slideshow metadata',()=>{
 const scenes=['hook','path','fruit','leaf','final'].map((id)=>({id,type:'video',audioIntent:'ambience',duration:3,volume:0.7}));
 const story={goal:'Autumn approaches winter',outcome:'Our path will change',evidenceRef:'synthetic reference',
   progression:scenes.map(s=>verifiedDelivery(s.id,'visual-story'))};
 assert.throws(()=>assertAudiovisualStory({scenes,story}),/STORY_AUDIBLE_HOOK_PAYOFF/);
 scenes[0].audioIntent=scenes[4].audioIntent='speech';
 story.progression[0]=verifiedDelivery('hook');
 story.progression[4]=verifiedDelivery('final');
 assert.throws(()=>assertAudiovisualStory({scenes,story}),/STORY_CONTINUITY_AUDIO_GAP/);
 scenes[2].audioIntent='speech';story.progression[2]=verifiedDelivery('fruit');
 assert.deepEqual(assertAudiovisualStory({scenes,story}).audibleSceneIds,['hook','fruit','final']);
 story.progression[2].delivery.listeningVerified=false;
 assert.throws(()=>assertAudiovisualStory({scenes,story}),/STORY_AUDIO_UNVERIFIED/);
});
