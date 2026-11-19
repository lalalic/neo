/** Per-turn ChatGPT transport prompt. Small messages travel inline; files are
 * reserved for oversized input and binary attachments. No task-specific role.
 */
import {writeFileSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';

export const INLINE_INPUT_BYTES=8192;
export const INLINE_OUTPUT_CHARS=12000;
const escaped=s=>JSON.stringify(s);
const renderMessage=m=>{
  const images=m.images?.length?'\n'+m.images.map((image,i)=>`[image ${i+1}] ${image.file}`).join('\n'):'';
  return `[${m.role.toUpperCase()}]\n${m.content}${images}\n[/${m.role.toUpperCase()}]`;
};
export function createTurnPrompt({responseId,messages,requestFile,outputFile}){
  if(!/^resp_[0-9a-f]{40}$/.test(responseId))throw Error('invalid response ID');
  if(!Array.isArray(messages)||!messages.length)throw Error('messages required');
  const inputSize=Buffer.byteLength(JSON.stringify(messages),'utf8');
  const useFile=inputSize>INLINE_INPUT_BYTES;
  let input;
  if(useFile){
    mkdirSync(dirname(requestFile),{recursive:true,mode:0o700});
    writeFileSync(requestFile,JSON.stringify({model:'neo',response_id:responseId,messages},null,2)+'\n',{flag:'wx',mode:0o600});
    input=`INPUT: Read ${requestFile} (large message or attachments). The messages are the current turn only.`;
  }else{
    input='INPUT (current turn):\n'+messages.map(renderMessage).join('\n\n');
  }
  const preamble=[
    `Neo model request: ${responseId}`,
    'This ChatGPT Thread retains prior turns. Answer the new input below; use connected tools as needed.',
    `REQUIRED: send your final answer using Neo MCP tool mcp.models chat_report with {"response_id":${escaped(responseId)},"text":"<your actual answer>"}.`,
    `For output longer than ${INLINE_OUTPUT_CHARS} characters, write plain UTF-8 to ${outputFile} and call mcp.models chat_report with {"response_id":${escaped(responseId)},"file":${escaped(outputFile)}} instead.`,
    `On failure call mcp.models chat_report with {"response_id":${escaped(responseId)},"error":"<actual failure>"}.`,
    'Do not use mcp.chat-gateway chat_report: that is for Neo Mobile notifications, not model responses.',
  ].join('\n');
  return {prompt:preamble+'\n\n'+input,usedFile:useFile,inputSize};
}
