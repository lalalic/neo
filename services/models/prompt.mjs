/** Stateless per-turn envelope: input is always inline, regardless of length.
 * WebHelm new-thread/new-turn own large-prompt transport. ChatGPT must use the
 * dedicated model chat_report tool; its normal web reply is not the API result.
 */
export function createTurnPrompt({responseId,messages}){
  if(!/^resp_[0-9a-f]{40}$/.test(responseId))throw Error('invalid response ID');
  if(!Array.isArray(messages)||!messages.length)throw Error('messages required');
  const lines=[
    `Neo model request: ${responseId}`,
    'The API caller receives your answer ONLY via mcp.models chat_report; a regular ChatGPT reply is not delivered.',
    `Send the actual answer using mcp.models chat_report({"response_id":"${responseId}","text":"<actual answer>"}).`,
    '',
  ];
  for(const m of messages){
    const role=m.role.toUpperCase();
    const images=m.images?.length?'\n'+m.images.map((image,i)=>`[image ${i+1}] ${image.file}`).join('\n'):'';
    lines.push(`[${role}]\n${m.content}${images}\n[/${role}]`);
  }
  return {prompt:lines.join('\n\n')};
}
