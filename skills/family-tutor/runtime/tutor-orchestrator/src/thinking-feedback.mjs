const THINKING_REACTION = '🤔';
const THINKING_TEXT = 'Neo is thinking…';
const active = new Map();

function keyFor(message){ return `${message.channelId}:${message.id}`; }

export async function beginThinkingFeedback(message){
  const key=keyFor(message);
  const existing=active.get(key);
  if(existing) return existing;
  const state={done:false,reply:null,removeReaction:null};
  state.clear=async()=>{
    if(state.done) return;
    state.done=true;
    active.delete(key);
    await state.reply?.delete().catch(()=>{});
    await state.removeReaction?.().catch(()=>{});
  };
  active.set(key,state);
  try{
    const reaction=await message.react(THINKING_REACTION);
    state.removeReaction=()=>reaction.remove();
  }catch(error){ console.warn('[family-tutor] could not add thinking reaction',error?.message||error); }
  try{
    state.reply=await message.reply({content:THINKING_TEXT,failIfNotExists:false});
  }catch(error){ console.warn('[family-tutor] could not send thinking message',error?.message||error); }
  return state;
}

export const thinkingFeedbackText=THINKING_TEXT;
export const thinkingFeedbackReaction=THINKING_REACTION;
