import fs from 'node:fs';
import path from 'node:path';
import { Client, Events, GatewayIntentBits } from 'discord.js';
import { loadConfig } from './config.mjs';
import { DevMacBridgeChatGPT } from './backends/devmacbridge.mjs';
import { collectImageAttachments, understandImages } from './vision.mjs';
import { isAudioAttachment, transcribeAudioAttachments } from './asr.mjs';

const configFile=process.env.FAMILY_TUTOR_CONFIG;
if(!configFile) throw new Error('FAMILY_TUTOR_CONFIG is required');
const config=loadConfig(configFile);
const discordToken=process.env.DISCORD_BOT_TOKEN?.trim();
if(!discordToken) throw new Error('DISCORD_BOT_TOKEN is required');

function readState(){ try{return JSON.parse(fs.readFileSync(config.stateFile,'utf8'))}catch(e){if(e.code==='ENOENT') return {version:1,conversations:{}}; throw e} }
function writeState(s){ fs.mkdirSync(path.dirname(config.stateFile),{recursive:true}); fs.writeFileSync(config.stateFile,`${JSON.stringify(s,null,2)}\n`,{mode:0o600}); }
const state=readState();
for(const child of config.children){ if(child.conversationId&&!state.conversations[child.id]) state.conversations[child.id]=child.conversationId; }
writeState(state);

const backend=new DevMacBridgeChatGPT(config.chatgpt);
let backendTail=Promise.resolve();
function backendTurn(input){
  const run=backendTail.catch(()=>{}).then(()=>backend.turn(input));
  backendTail=run.catch(()=>{});
  return run;
}
const childByChannel=new Map(config.children.map(c=>[c.discordChannelId,c]));
const queues=new Map();
const client=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMessages,GatewayIntentBits.MessageContent]});

function bootstrapPrompt(child,message){
  const profile=[
    child.grade ? `grade ${child.grade}` : null,
    child.school ? `school: ${child.school}` : null,
    child.location ? `location: ${child.location}` : null,
    child.gender ? `gender: ${child.gender}` : null,
  ].filter(Boolean).join(', ');
  const parentNames=(config.parents||[]).map(p=>`${p.name}${p.role?` (${p.role})`:''}`).join(', ');
  return `You are the persistent personal tutor for ${child.name}${profile?` (${profile})`:''}.
${parentNames?`Parents/guardians for this family: ${parentNames}.`:''}
Teach rather than simply answering homework. Diagnose understanding, prefer hints and guided questions, keep one focused step at a time, adapt to the child's level and school context, and verify understanding with evidence when useful. Never mix another child's context into this conversation. Treat school, location, gender, and family details as private contextual information and mention them only when relevant to tutoring.

After the student-facing answer, append a compact parent telemetry block exactly between these markers:
<FAMILY_TUTOR_PARENT>
Topic: ...
Evidence: ...
Difficulty: ...
Next: ...
Parent note: ...
</FAMILY_TUTOR_PARENT>
Keep telemetry concise. The bridge removes it from the child's reply.

Student message:\n${message}`;
}
function parseTutorText(text){ const m=text.match(/<FAMILY_TUTOR_PARENT>\s*([\s\S]*?)\s*<\/FAMILY_TUTOR_PARENT>/i); return {childText:text.replace(/<FAMILY_TUTOR_PARENT>[\s\S]*?<\/FAMILY_TUTOR_PARENT>/i,'').trim(),parentText:m?.[1]?.trim()||null}; }
async function sendChunks(channel,text){ let remaining=text; while(remaining.length>1900){let split=remaining.lastIndexOf('\n',1900); if(split<800) split=1900; await channel.send(remaining.slice(0,split)); remaining=remaining.slice(split).trimStart();} if(remaining) await channel.send(remaining); }
function collectAttachments(message){
  return [...message.attachments.values()].slice(0,4).map(a=>({
    url:a.url,
    name:a.name||`attachment-${a.id}`,
    mimeType:a.contentType||'',
    size:Number(a.size||0),
  }));
}
async function sendAssistantOutputs(channel,outputs=[]){
  for(const output of outputs.slice(0,6)){
    if(!output?.data?.length) continue;
    try{
      await channel.send({files:[{attachment:output.data,name:output.name||'attachment'}]});
    }catch(error){
      console.error('[family-tutor] Discord output attachment failed',error);
      await channel.send(`I created **${output.name||'a file'}**, but Discord could not accept the attachment.`).catch(()=>{});
    }
  }
}
async function handleChildMessage(message,child){
  const incoming=message.content.trim();
  const attachments=collectAttachments(message);
  if(!incoming && !attachments.length) return;
  await message.channel.sendTyping();
  const audioAttachments=attachments.filter(isAudioAttachment);
  const nonAudioAttachments=attachments.filter(a=>!isAudioAttachment(a));
  let voiceTranscript=null;
  if(audioAttachments.length){
    try{
      voiceTranscript=await transcribeAudioAttachments(audioAttachments);
    }catch(error){
      console.error(`[family-tutor] ${child.id} local ASR failed`,error);
      return message.reply('I received your voice message, but I could not transcribe it locally. Please try again or send it as text.');
    }
  }
  const voiceBlock=voiceTranscript?`[VOICE MESSAGE TRANSCRIPT — preserve the student's spoken meaning; do not judge grammar or writing quality from this transcript]\n${voiceTranscript}\n[/VOICE MESSAGE TRANSCRIPT]`:'';
  const studentMessage=[incoming,voiceBlock].filter(Boolean).join('\n\n') || 'Please help me understand the attached file(s).';
  const conversationId=state.conversations[child.id]||child.conversationId||null;
  let result;
  try{
    result=await backendTurn({
      prompt:conversationId?studentMessage:bootstrapPrompt(child,studentMessage),
      conversationId,
      attachments:nonAudioAttachments,
    });
  }catch(error){
    const imageAttachments=collectImageAttachments(message);
    const onlyImages=nonAudioAttachments.length>0 && imageAttachments.length===nonAudioAttachments.length;
    if(!onlyImages) throw error;
    console.warn(`[family-tutor] ${child.id} direct ChatGPT attachment failed; using local image fallback`,error?.message||error);
    let imageContext;
    try{ imageContext=await understandImages(imageAttachments,incoming); }
    catch(visionError){
      console.error(`[family-tutor] ${child.id} image fallback failed`,visionError);
      return message.reply('I received your file, but ChatGPT upload and the local image fallback both failed. Please try again or send the question as text.');
    }
    const grounded=`${studentMessage}\n\n[GROUNDING FROM STUDENT IMAGE — fallback visual analysis]\n${imageContext}\n[/GROUNDING FROM STUDENT IMAGE]`;
    result=await backendTurn({prompt:conversationId?grounded:bootstrapPrompt(child,grounded),conversationId});
  }
  if(!conversationId){state.conversations[child.id]=result.conversationId; writeState(state);}
  const parsed=parseTutorText(result.text);
  await sendChunks(message.channel,parsed.childText||result.text);
  await sendAssistantOutputs(message.channel,result.outputs);
  if(parsed.parentText){ const parent=await client.channels.fetch(config.discord.parentChannelId); if(parent?.isTextBased()) await sendChunks(parent,`📘 **${child.name}**\n${parsed.parentText}`); }
}


async function handleParentControl(message){
  const text=message.content.trim();
  if(!text.startsWith('!')) return;
  const [command,childId,...rest]=text.split(/\s+/);
  if(command==='!help') return message.reply('Commands: `!goal <childId> <goal>`, `!focus <childId> <focus>`, `!ask <childId> <question>`, `!threads`');
  if(command==='!threads'){
    const rows=config.children.map(c=>`${c.id}: ${state.conversations[c.id]?'bound':'not started'}`);
    return message.reply(rows.join('\n'));
  }
  const child=config.children.find(c=>c.id===childId);
  if(!child) return message.reply(`Unknown child id. Use one of: ${config.children.map(c=>c.id).join(', ')}`);
  const conversationId=state.conversations[child.id]||child.conversationId||null;
  if(!conversationId) return message.reply(`${child.name}'s tutor conversation has not started yet. Send the first message in the child tutor channel first.`);
  const value=rest.join(' ').trim();
  if(!value) return message.reply('Please include the goal, focus, or question.');
  let prompt;
  if(command==='!goal') prompt=`[PARENT CONTROL] Add this durable tutoring goal for ${child.name}: ${value}. Keep it in mind in future tutoring. Reply briefly to the parent only.`;
  else if(command==='!focus') prompt=`[PARENT CONTROL] Make this the current tutoring focus for ${child.name}: ${value}. Apply it when relevant in future tutoring. Reply briefly to the parent only.`;
  else if(command==='!ask') prompt=`[PARENT QUESTION] Answer the parent about ${child.name}'s learning based only on this tutor conversation: ${value}`;
  else return;
  const result=await backendTurn({prompt,conversationId});
  const parsed=parseTutorText(result.text);
  return sendChunks(message.channel,parsed.childText||result.text);
}

function serialize(childId,work){ const prev=queues.get(childId)||Promise.resolve(); const next=prev.catch(()=>{}).then(work).finally(()=>{if(queues.get(childId)===next) queues.delete(childId)}); queues.set(childId,next); return next; }

client.once(Events.ClientReady,c=>console.log(`[family-tutor] ready as ${c.user.tag}`));
client.on(Events.MessageCreate,message=>{
  if(message.author.bot) return;
  const child=childByChannel.get(message.channelId);
  if(child){
    serialize(child.id,()=>handleChildMessage(message,child)).catch(error=>{console.error(`[family-tutor] ${child.id} turn failed`,error); message.reply('The tutor is temporarily unavailable. Please try again shortly.').catch(()=>{});});
    return;
  }
  if(config.discord.parentChannelId && message.channelId===config.discord.parentChannelId){
    const childId=message.content.trim().split(/\s+/)[1];
    const target=config.children.find(c=>c.id===childId);
    const key=target?.id||'parent-control';
    serialize(key,()=>handleParentControl(message)).catch(error=>{console.error('[family-tutor] parent control failed',error); message.reply('Parent control is temporarily unavailable.').catch(()=>{});});
  }
});
await client.login(discordToken);
