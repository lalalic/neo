/** Source-backed narrative plan must exist before Producer compiles media.
 * Scenes are evidence chosen to advance a story, not media to narrate in upload order.
 */
export function assertStoryPlan(input){
 const {story,scenes}=input??{};
 if(!story||!scenes?.length)throw Error('STORY_FIRST_REQUIRED: Director must supply a source-grounded story plan before production');
 for(const field of ['goal','outcome','evidenceRef'])if(typeof story[field]!=='string'||!story[field].trim())throw Error(`STORY_FIRST_REQUIRED: story.${field} is missing`);
 if(!Array.isArray(story.progression)||story.progression.length!==scenes.length)throw Error('STORY_CONTINUITY_REQUIRED: progression must explain every source scene in order');
 for(let i=0;i<scenes.length;i++){
  const beat=story.progression[i];
  if(beat?.sceneId!==scenes[i].id||!beat.purpose?.trim())throw Error(`STORY_CONTINUITY_REQUIRED: scene ${scenes[i].id} has no ordered narrative purpose`);
 }
 if(story.progression[0].purpose==='payoff'||story.progression.at(-1).purpose==='hook')throw Error('STORY_CONTINUITY_REQUIRED: hook/payoff sequence is inverted');
 return {goal:story.goal,outcome:story.outcome,evidenceRef:story.evidenceRef,sourceSceneIds:story.progression.map(b=>b.sceneId)};
}

/** Verify that story beats reach the viewer as real picture/sound, not metadata.
 * A meaningful source utterance requires verified listening, not unreviewed STT.
 */
export function assertAudiovisualStory(input){
 const storyPlan=assertStoryPlan(input);
 const {scenes,story}=input;
 const spoken=[];
 for(const [i,scene] of scenes.entries()){
  const beat=story.progression[i];
  const delivery=beat.delivery;
  if(!delivery || !['source-speech','voiceover','visual-story'].includes(delivery.mode))
   throw Error('STORY_DELIVERY_REQUIRED: '+scene.id+' needs a real delivery mode');
  if(!delivery.evidenceRef?.trim())
   throw Error('STORY_DELIVERY_REQUIRED: '+scene.id+' needs a source-linked delivery reference');
  if(delivery.mode==='source-speech'){
   if(scene.type!=='video'||!['speech','dialogue'].includes(scene.audioIntent) ||
      scene.volume===0 || scene.override?.sourceAudioVolume===0 || delivery.listeningVerified!==true)
    throw Error('STORY_AUDIO_UNVERIFIED: '+scene.id+' needs verified, audible source speech');
   spoken.push(i);
  }
  if(delivery.mode==='voiceover'){
   if(!scene.audioPath || !(scene.audioDuration>0) || !delivery.narrationText?.trim())
    throw Error('STORY_VOICEOVER_MISSING: '+scene.id+' has no rendered narration');
   if(scene.type==='video' && scene.audioDuration>scene.duration)
    throw Error('STORY_VOICEOVER_DURATION: '+scene.id+' ends before narration');
   spoken.push(i);
  }
 }
 if(!spoken.includes(0)||!spoken.includes(scenes.length-1))
  throw Error('STORY_AUDIBLE_HOOK_PAYOFF: opening and payoff must be audible');
 // A long silent scenic sequence cannot be a spoken story, even with beat labels.
 const maxSilentRun=Math.max(0,...[-1,...spoken,scenes.length].slice(1).map((end,j)=>
  end-[-1,...spoken,scenes.length][j]-1));
 if(maxSilentRun>2)
  throw Error('STORY_CONTINUITY_AUDIO_GAP: more than two consecutive non-narrated scenes');
 return {...storyPlan,audibleSceneIds:spoken.map(i=>scenes[i].id)};
}
