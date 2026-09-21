import fs from 'node:fs';
import path from 'node:path';
import { Client, Events, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from 'discord.js';
import { loadConfig } from './config.mjs';
import { CodexBackend } from './backends/codex.mjs';
import { collectImageAttachments, understandImages } from './vision.mjs';
import { isAudioAttachment, transcribeAudioAttachments } from './asr.mjs';
import { buildParentContextPrompt, buildSlashStatusPrompt, canUseStatus, findChild, formatSlashOverview, formatSlashStatus, isAuthorizedParent, parseParentCommand, parseParentMessage, statusCommand, statusDenialMessage } from './parent-context.mjs';

const configFile=process.env.FAMILY_TUTOR_CONFIG;
if(!configFile) throw new Error('FAMILY_TUTOR_CONFIG is required');
const config=loadConfig(configFile);
const discordToken=process.env.DISCORD_BOT_TOKEN?.trim();
if(!discordToken) throw new Error('DISCORD_BOT_TOKEN is required');

const backend=new CodexBackend(config.codex,{instanceDir:path.resolve(path.dirname(config.configPath),'..')});
const childByChannel=new Map(config.children.map(c=>[c.discordChannelId,c]));
function agentsFile(child){ return path.resolve(path.dirname(config.configPath),'..',child.id,'AGENTS.md'); }
function ensureAgents(child){ const file=agentsFile(child); if(fs.existsSync(file)) return; fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,`# ${child.name} Agent Context\n\n`,{mode:0o600}); }
for(const child of config.children) ensureAgents(child);
const queues=new Map();
const client=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMessages,GatewayIntentBits.MessageContent]});

function turnPrompt(_child,message){ return `Student message:\n${message}`; }
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
function writeAgents(child,text){
  if(!text) return;
  if(Buffer.byteLength(text,'utf8')>100000) throw new Error(`AGENTS.md update for ${child.id} exceeds 100 KB`);
  const file=agentsFile(child); const tmp=`${file}.tmp`;
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(tmp,`${text.trim()}\n`,{mode:0o600});
  fs.renameSync(tmp,file);
}
async function applyTutorSideEffects(child,parsed){
  if(parsed.memoryText) writeAgents(child,parsed.memoryText);
  if(parsed.rollover) await backend.newThread({childId:child.id});
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
  let result;
  try{
    result=await backend.turn({
      prompt:turnPrompt(child,studentMessage),
      childId:child.id,
      attachments:nonAudioAttachments,
    });
  }catch(error){
    const imageAttachments=collectImageAttachments(message);
    const onlyImages=nonAudioAttachments.length>0 && imageAttachments.length===nonAudioAttachments.length;
    if(!onlyImages) throw error;
    console.warn(`[family-tutor] ${child.id} direct Codex attachment failed; using local image fallback`,error?.message||error);
    let imageContext;
    try{ imageContext=await understandImages(imageAttachments,incoming); }
    catch(visionError){
      console.error(`[family-tutor] ${child.id} image fallback failed`,visionError);
      return message.reply('I received your file, but Codex and the local image fallback both failed. Please try again or send the question as text.');
    }
    const grounded=`${studentMessage}\n\n[GROUNDING FROM STUDENT IMAGE — fallback visual analysis]\n${imageContext}\n[/GROUNDING FROM STUDENT IMAGE]`;
    result=await backend.turn({prompt:turnPrompt(child,grounded),childId:child.id});
  }
  const parsed=parseTutorText(result.text);
  await applyTutorSideEffects(child,parsed);
  await sendChunks(message.channel,parsed.childText||result.text);
  await sendAssistantOutputs(message.channel,result.outputs);
  if(parsed.parentText){ const parent=await client.channels.fetch(config.discord.parentChannelId); if(parent?.isTextBased()) await sendChunks(parent,`📘 **${child.name}**\n${parsed.parentText}`); }
}


async function handleParentControl(message){
  if(!isAuthorizedParent(message,config)) return;
  const command=parseParentMessage(message.content,config.children);
  if(!command) return;
  if(command.command==='!help') return message.reply('Commands: `!goal <childId> <goal>`, `!focus <childId> <focus>`, `!guide <childId> <guidance>`, `!ask <childId> <question>`, `!status <childId> <question>`, `!threads`');
  if(command.command==='!threads') return message.reply(config.children.map(c=>`${c.id}: one persistent tutor thread`).join('\n'));
  const child=config.children.find(c=>c.id===command.childId);
  if(!child) return message.reply(`Unknown child id. Use one of: ${config.children.map(c=>c.id).join(', ')}`);
  if(!command.value) return message.reply('Please include the goal, focus, guidance, or question.');
  const prompt=buildParentContextPrompt({child,command:command.command,value:command.value,authorId:message.author.id,messageId:message.id});
  const result=await backend.turn({prompt,childId:child.id});
  const parsed=parseTutorText(result.text);
  await applyTutorSideEffects(child,parsed);
  return sendChunks(message.channel,parsed.childText||result.text);
}

function learnerMemory(child){ try{return fs.readFileSync(agentsFile(child),'utf8');}catch{return '';} }
async function statusForChild(child){
  const result=await backend.turn({prompt:buildSlashStatusPrompt({child,memory:learnerMemory(child)}),childId:child.id});
  return formatSlashStatus(child,result.text);
}
async function handleStatusInteraction(interaction){
  if(!canUseStatus({channelId:interaction.channelId,userId:interaction.user.id},config)) return interaction.reply({content:statusDenialMessage(),ephemeral:true});
  const requested=interaction.options.getString('child');
  const child=requested?findChild(config.children,requested):null;
  if(requested&&!child) return interaction.reply({content:`Unknown child. Use one of: ${config.children.map((item)=>item.name).join(', ')}`,ephemeral:true});
  await interaction.deferReply();
  const statuses=[];
  for(const target of child?[child]:config.children) statuses.push(await serialize(target.id,()=>statusForChild(target)));
  return interaction.editReply(formatSlashOverview(statuses));
}
async function syncSlashCommands(applicationId){
  const rest=new REST({version:'10'}).setToken(discordToken);
  const command=new SlashCommandBuilder().setName(statusCommand.name).setDescription(statusCommand.description).addStringOption((option)=>option.setName('child').setDescription('Child name (optional)').setRequired(false));
  await rest.put(Routes.applicationCommands(applicationId),{body:[command.toJSON()]});
}

function serialize(childId,work){ const prev=queues.get(childId)||Promise.resolve(); const next=prev.catch(()=>{}).then(work).finally(()=>{if(queues.get(childId)===next) queues.delete(childId)}); queues.set(childId,next); return next; }

client.once(Events.ClientReady,c=>console.log(`[family-tutor-orchestrator] ready as ${c.user.tag}`));
client.once(Events.ClientReady,(c)=>syncSlashCommands(c.user.id).then(()=>console.log('[family-tutor-orchestrator] /status command synced')).catch((error)=>console.error('[family-tutor] slash command sync failed',error)));
client.on(Events.InteractionCreate,(interaction)=>{
  if(!interaction.isChatInputCommand()||interaction.commandName!==statusCommand.name) return;
  handleStatusInteraction(interaction).catch((error)=>{
    console.error('[family-tutor] /status failed',error);
    const reply={content:'Status is temporarily unavailable. Please try again shortly.',ephemeral:true};
    if(interaction.deferred||interaction.replied) interaction.editReply(reply).catch(()=>{}); else interaction.reply(reply).catch(()=>{});
  });
});
client.on(Events.MessageCreate,message=>{
  if(message.author.bot) return;
  const child=childByChannel.get(message.channelId);
  if(child){
    serialize(child.id,()=>handleChildMessage(message,child)).catch(error=>{console.error(`[family-tutor] ${child.id} turn failed`,error); message.reply('The tutor is temporarily unavailable. Please try again shortly.').catch(()=>{});});
    return;
  }
  if(config.discord.parentChannelId && message.channelId===config.discord.parentChannelId){
    const command=parseParentMessage(message.content,config.children);
    const target=config.children.find(c=>c.id===command?.childId);
    const key=target?.id||'parent-control';
    serialize(key,()=>handleParentControl(message)).catch(error=>{console.error('[family-tutor] parent control failed',error); message.reply('Parent control is temporarily unavailable.').catch(()=>{});});
  }
});
await client.login(discordToken);
