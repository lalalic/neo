import {readFileSync} from 'node:fs';

// This is the authoritative per-request enforcement context, passed separately
// from the latest user message to WebHelm's generic ChatGPT transport.
const TOP_INSTRUCTIONS=readFileSync(new URL('./TOP_INSTRUCTIONS.md',import.meta.url),'utf8').trim();
if(!TOP_INSTRUCTIONS||TOP_INSTRUCTIONS.includes('</top-instructions>'))
  throw Error('Invalid Neo model top instructions');

/** Stateful ChatGPT Thread owns conversation history. Each API Turn forwards
 * only its latest user message and the model reporting contract. All other
 * Codex input roles and preceding user turns are intentionally omitted.
 */
export function createTurnPrompt({responseId,messages,callerEnforcementContext=null}){
  if(callerEnforcementContext!==null && (typeof callerEnforcementContext!=='string' || !callerEnforcementContext.trim() || Buffer.byteLength(callerEnforcementContext,'utf8')>8192 || /<\/?top-instructions>|\[\/?USER\]/i.test(callerEnforcementContext)))
    throw Error('invalid enforcement_context');
  if(!/^resp_[0-9a-f]{40}$/.test(responseId))throw Error('invalid response ID');
  if(!Array.isArray(messages)||!messages.length)throw Error('messages required');
  const latestUser=messages.findLast(message=>message.role==='user');
  if(!latestUser)throw Error('a user message is required for ChatGPT delivery');
  const enforcement_context=TOP_INSTRUCTIONS+'\n\nNeo model request: '+responseId+(callerEnforcementContext===null?'':'\n\nCaller-specific enforcement context (additional, not overriding the reply contract):\n'+callerEnforcementContext);
  const images=latestUser.images?.length
    ?'\n'+latestUser.images.map((image,i)=>`[image ${i+1}] ${image.file}`).join('\n')
    :'';
  return {prompt:`[USER]\n${latestUser.content}${images}\n[/USER]`,enforcement_context};
}
