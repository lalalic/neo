/** Stateless per-turn envelope: input is always inline, regardless of length.
 * WebHelm new-thread/new-turn own large-prompt transport. ChatGPT must use the
 * dedicated ChatGPT Project custom instructions for the chat_report contract.
 */
export function createTurnPrompt({responseId,messages,projectBound=false}){
  if(!/^resp_[0-9a-f]{40}$/.test(responseId))throw Error('invalid response ID');
  if(!Array.isArray(messages)||!messages.length)throw Error('messages required');
  // Project instructions own the reporting contract; do not repeat it on
  // every request. Preserve the legacy fallback until Project setup verifies.
  const lines=projectBound
    ? [`Neo model request: ${responseId}`,'']
    : [
      `Neo model request: ${responseId}`,
      'The API caller receives the answer ONLY via the real MCP tool mcp.models chat_report; a regular ChatGPT reply is not delivered.',
      `Send one or more chat_report({"response_id":"${responseId}","text":"<answer segment>"}) calls. Text never completes the Turn.`,
      `After the FINAL text report, MUST call chat_report({"response_id":"${responseId}","completed":true}) separately.`,
      `For long work, call chat_report({"response_id":"${responseId}","heartbeat":true}) every 45 seconds. On failure send chat_report with {response_id, error}.`,
      '',
    ];
  for(const m of messages){
    const role=m.role.toUpperCase();
    const images=m.images?.length?'\n'+m.images.map((image,i)=>`[image ${i+1}] ${image.file}`).join('\n'):'';
    lines.push(`[${role}]\n${m.content}${images}\n[/${role}]`);
  }
  return {prompt:lines.join('\n\n')};
}
