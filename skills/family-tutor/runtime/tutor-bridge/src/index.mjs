import fs from 'node:fs';
import path from 'node:path';
import { Client, Events, GatewayIntentBits } from 'discord.js';
import { loadConfig } from './config.mjs';
import { DevMacBridgeChatGPT } from './backends/devmacbridge.mjs';
import { collectImageAttachments, understandImages } from './vision.mjs';
import { isAudioAttachment, transcribeAudioAttachments } from './asr.mjs';
import { bootstrapPrompt, turnPrompt } from './prompts.mjs';

const configFile=process.env.FAMILY_TUTOR_CONFIG;
if(!configFile) throw new Error('FAMILY_TUTOR_CONFIG is required');
const config=loadConfig(configFile);
const discordToken=process.env.DISCORD_BOT_TOKEN?.trim();
if(!discordToken) throw new Error('DISCORD_BOT_TOKEN is required');

const backend=new DevMacBridgeChatGPT(config.chatgpt);
const childByChannel=new Map(config.children.map(c=>[c.discordChannelId,c]));
function memoryFile(child){ return path.resolve(path.dirname(config.configPath),'..',child.id,'memory.md'); }
function readMemory(child){ try{return fs.readFileSync(memoryFile(child),'utf8').trim()}catch(e){if(e.code==='ENOENT') return ''; throw e} }
function ensureMemory(child){ const file=memoryFile(child); if(fs.existsSync(file)) return; fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,`# ${child.name} Memory\n\n`,{mode:0o600}); }
for(const child of config.children) ensureMemory(child);
const queues=new Map();
const client=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMessages,GatewayIntentBits.MessageContent]});

function parseTutorText(text){
  const parent=text.match(/<FAMILY_TUTOR_PARENT>\s*([\s\S]*?)\s*<\/FAMILY_TUTOR_PARENT>/i);
  const memory=text.match(/<FAMILY_TUTOR_MEMORY>\s*([\s\S]*?)\s*<\/FAMILY_TUTOR_MEMORY>/i);
  const rollover=/<FAMILY_TUTOR_ROLLOVER\s*\/>/i.test(text);
  const childText=text
    .replace(/<FAMILY_TUTOR_PARENT>[\s\S]*?<\/FAMILY_TUTOR_PARENT>/ig,'')
    .replace(/<FAMILY_TUTOR_MEMORY>[\s\S]*?<\/FAMILY_TUTOR_MEMORY>/ig,'')
    .replace(/<FAMILY_TUTOR_ROLLOVER\s*\/>/ig,'')
    .trim();
  return {childText,parentText:parent?.[1]?.trim()||null,memoryText:memory?.[1]?.trim()||null,rollover};
}
function writeMemory(child,text){
  if(!text) return;
  if(Buffer.byteLength(text,'utf8')>100000) throw new Error(`memory update for ${child.id} exceeds 100 KB`);
  const file=memoryFile(child); const tmp=`${file}.tmp`;
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(tmp,`${text.trim()}\n`,{mode:0o600});
  fs.renameSync(tmp,file);
}
async function applyTutorSideEffects(child,parsed){
  if(parsed.memoryText) writeMemory(child,parsed.memoryText);
  if(parsed.rollover) await backend.newThread({projectId:child.projectId,tabId:child.tabId});
}
async function sendChunks(channel,text){ let remaining=text; while(remaining.length>1900){let split=remaining.lastIndexOf('\n',1900); if(split<800) split=1900; await channel.send(remaining.slice(0,split)); remaining=remaining.slice(split).trimStart();} if(remaining) await channel.send(remaining); }
function collectAttachments(message){
  return [...message.attachments.values()].slice(0,4).map(a=>({
    url:a.url,
    name:a.name||`attachment-${a.id}`,
    mimeType:a.contentType||'',
    size:Number(a.size||0),
  }));
}
function parentControlPrompts(child,text){
  return {prompt:turnPrompt(text),bootstrapPrompt:bootstrapPrompt(child,text,readMemory(child))};
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
  const bootstrap=bootstrapPrompt(child,studentMessage,readMemory(child));
  const prompt=turnPrompt(studentMessage);
  let result;
  try{
    result=await backend.turn({
      prompt,
      bootstrapPrompt:bootstrap,
      projectId:child.projectId,
      tabId:child.tabId,
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
    result=await backend.turn({prompt:turnPrompt(grounded),bootstrapPrompt:bootstrapPrompt(child,grounded,readMemory(child)),projectId:child.projectId,tabId:child.tabId});
  }
  const parsed=parseTutorText(result.text);
  await applyTutorSideEffects(child,parsed);
  await sendChunks(message.channel,parsed.childText||result.text);
  await sendAssistantOutputs(message.channel,result.outputs);
  if(parsed.parentText){ const parent=await client.channels.fetch(config.discord.parentChannelId); if(parent?.isTextBased()) await sendChunks(parent,`📘 **${child.name}**\n${parsed.parentText}`); }
}


async function handleParentControl(message){
  const text=message.content.trim();
  if(!text.startsWith('!')) return;
  const [command,childId,...rest]=text.split(/\s+/);
  if(command==='!help') return message.reply('Commands: `!goal <childId> <goal>`, `!focus <childId> <focus>`, `!ask <childId> <question>`, `!threads`');
  if(command==='!threads'){ return message.reply(config.children.map(c=>`${c.id}: dedicated ChatGPT Project + tab`).join('\n')); }
  const child=config.children.find(c=>c.id===childId);
  if(!child) return message.reply(`Unknown child id. Use one of: ${config.children.map(c=>c.id).join(', ')}`);
  const value=rest.join(' ').trim();
  if(!value) return message.reply('Please include the goal, focus, or question.');
  let controlText;
  if(command==='!goal') controlText=`[PARENT CONTROL] Add this durable tutoring goal for ${child.name}: ${value}. Keep it in mind in future tutoring. Reply briefly to the parent only.`;
  else if(command==='!focus') controlText=`[PARENT CONTROL] Make this the current tutoring focus for ${child.name}: ${value}. Apply it when relevant in future tutoring. Reply briefly to the parent only.`;
  else if(command==='!ask') controlText=`[PARENT QUESTION] Answer the parent about ${child.name}'s learning using the current tutor context and durable memory: ${value}`;
  else return;
  const {prompt,bootstrapPrompt}=parentControlPrompts(child,controlText);
  const result=await backend.turn({prompt,bootstrapPrompt,projectId:child.projectId,tabId:child.tabId});
  const parsed=parseTutorText(result.text);
  await applyTutorSideEffects(child,parsed);
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
