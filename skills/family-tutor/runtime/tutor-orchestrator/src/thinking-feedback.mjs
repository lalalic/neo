const THINKING_REACTION = '🤔';
const active = new Map();

function keyFor(message){ return `${message.channelId}:${message.id}`; }

export async function beginThinkingFeedback(message){
  const key=keyFor(message);
  const existing=active.get(key);
  if(existing) return existing;
  const state={done:false,removeReaction:null};
  state.clear=async()=>{
    if(state.done) return;
    state.done=true;
    active.delete(key);
    await state.removeReaction?.().catch(()=>{});
  };
  active.set(key,state);
  try{
    const reaction=await message.react(THINKING_REACTION);
    state.removeReaction=()=>reaction.remove();
  }catch(error){ console.warn('[family-tutor] could not add thinking reaction',error?.message||error); }
  return state;
}

export const thinkingFeedbackReaction=THINKING_REACTION;
