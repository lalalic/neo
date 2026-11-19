import {readFileSync} from 'node:fs';

// This is the only source of truth for the ChatGPT reporting instructions.
// It is injected into EVERY API Turn, including existing Codex conversations.
const TOP_INSTRUCTIONS=readFileSync(new URL('./TOP_INSTRUCTIONS.md',import.meta.url),'utf8').trim();
if(!TOP_INSTRUCTIONS||TOP_INSTRUCTIONS.includes('</top-instructions>'))
  throw Error('Invalid Neo model top instructions');

/** Stateful ChatGPT Thread owns conversation history. Each API Turn forwards
 * only its latest user message and the model reporting contract. All other
 * Codex input roles and preceding user turns are intentionally omitted.
 */
export function createTurnPrompt({responseId,messages}){
  if(!/^resp_[0-9a-f]{40}$/.test(responseId))throw Error('invalid response ID');
  if(!Array.isArray(messages)||!messages.length)throw Error('messages required');
  const latestUser=messages.findLast(message=>message.role==='user');
  if(!latestUser)throw Error('a user message is required for ChatGPT delivery');
  const lines=[
    `<top-instructions>\n${TOP_INSTRUCTIONS}\n</top-instructions>`,
    `Neo model request: ${responseId}`,
  ];
  const images=latestUser.images?.length
    ?'\n'+latestUser.images.map((image,i)=>`[image ${i+1}] ${image.file}`).join('\n')
    :'';
  lines.push(`[USER]\n${latestUser.content}${images}\n[/USER]`);
  return {prompt:lines.join('\n\n')};
}
