import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function readConfigEnv(file){
  try {
    const text=fs.readFileSync(file,'utf8');
    const out={};
    for(const raw of text.split(/\r?\n/)){
      const line=raw.trim();
      if(!line || line.startsWith('#')) continue;
      const i=line.indexOf('=');
      if(i>0) out[line.slice(0,i).trim()]=line.slice(i+1).trim();
    }
    return out;
  } catch { return {}; }
}

function resolveEndpoint(){
  if(process.env.MAC_DEV_BRIDGE_CHATGPT_ENDPOINT) return process.env.MAC_DEV_BRIDGE_CHATGPT_ENDPOINT;
  const dataDir=process.env.MAC_DEV_BRIDGE_DATA_DIR || repoDataDir();
  const cfg=readConfigEnv(path.join(dataDir,'config.env'));
  const port=process.env.MAC_DEV_BRIDGE_HTTP_PORT || cfg.MAC_DEV_BRIDGE_HTTP_PORT || '8787';
  return `http://127.0.0.1:${port}/experimental/chatgpt/conversation`;
}

const ENDPOINT=resolveEndpoint();
const here=path.dirname(fileURLToPath(import.meta.url));

function readTokenFile(file){
  try { const value=fs.readFileSync(file,'utf8').trim(); return value || null; }
  catch { return null; }
}
function resolveToken(){
  const direct=process.env.MAC_DEV_BRIDGE_HTTP_TOKEN?.trim();
  if(direct) return direct;
  const candidates=[
    process.env.MAC_DEV_BRIDGE_HTTP_TOKEN_FILE,
    process.env.MAC_DEV_BRIDGE_DATA_DIR ? path.join(process.env.MAC_DEV_BRIDGE_DATA_DIR,'http-token') : null,
    path.join(os.homedir(),'Library','Application Support','MacDeveloperBridge','http-token'),
    path.resolve(here,'../../../../devmacbridge/.state/http-token'),
  ].filter(Boolean);
  for(const file of candidates){ const token=readTokenFile(file); if(token) return token; }
  throw new Error('DevMacBridge HTTP bearer not found. Set MAC_DEV_BRIDGE_HTTP_TOKEN(_FILE) or run DevMacBridge setup.');
}

export class DevMacBridgeChatGPT{
  constructor(config){ this.config=config; }
  async turn({prompt,conversationId,attachments=[]}){
    const payload={prompt,transport:'runtime',model:this.config.model||'gpt-5-6-thinking',thinking_effort:this.config.thinkingEffort||'standard',max_runtime_seconds:this.config.maxRuntimeSeconds||600};
    if(Array.isArray(attachments)&&attachments.length){
      payload.attachments=attachments.slice(0,4).map(a=>({url:a.url,name:a.name,mime_type:a.mimeType||a.contentType||'',size:Number(a.size||0)}));
    }
    if(conversationId) payload.conversation_id=conversationId; else if(this.config.projectId) payload.project_id=this.config.projectId;
    if(Number.isInteger(this.config.tabId)) payload.tab_id=this.config.tabId;
    const response=await fetch(ENDPOINT,{method:'POST',headers:{authorization:`Bearer ${resolveToken()}`,'content-type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout((payload.max_runtime_seconds+30)*1000)});
    const text=await response.text(); let body; try{body=JSON.parse(text)}catch{body={raw:text}}
    if(!response.ok) throw new Error(`DevMacBridge ChatGPT request failed (${response.status}): ${body.error||body.message||text}`);
    const conversationIdOut=body.conversation_id||body.conversationId||body.result?.conversation_id||body.result?.conversationId;
    const answer=body.assistant_text||body.text||body.output_text||body.response||body.result?.assistant_text||body.result?.text||body.result?.output_text||body.result?.response;
    if(!conversationIdOut) throw new Error(`ChatGPT backend returned no conversation id: ${JSON.stringify(body)}`);
    if(typeof answer!=='string'||!answer) throw new Error(`ChatGPT backend returned no assistant text: ${JSON.stringify(body)}`);
    const outputs=(body.assistant_outputs||body.outputs||body.result?.assistant_outputs||[]).filter(o=>o&&typeof o==='object').map(o=>({
      type:o.type||'file',
      name:o.name||'attachment',
      mimeType:o.mime_type||o.mimeType||'application/octet-stream',
      size:Number(o.size||0),
      data:typeof o.data_base64==='string'?Buffer.from(o.data_base64,'base64'):null,
    })).filter(o=>o.data?.length);
    return {conversationId:conversationIdOut,text:answer,outputs};
  }
}
