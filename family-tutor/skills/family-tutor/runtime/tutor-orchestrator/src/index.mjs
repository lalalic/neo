import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ChannelType, Client, Events, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from 'discord.js';
import { loadConfig } from './config.mjs';
import { BrowserWorkspaceTutorClient } from './browser-workspace-tutor.mjs';
import { DiscordDeliveryRegistry } from './discord-delivery.mjs';
import { requireConfiguredLearners } from './learner-bindings.mjs';
import { isAudioAttachment, transcribeAudioAttachments } from './asr.mjs';
import { reactToReceivedChildMessage } from './discord-reactions.mjs';
import { buildParentContextPrompt, buildSlashStatusPrompt, canUseStatus, childProjectName, findChildByChannelName, formatSlashOverview, formatSlashStatus, isAuthorizedParent, parseParentMessage, renderParentNaturalText, statusCommand, statusDenialMessage, validateChildChannel } from './parent-context.mjs';
import { buildKidContext, buildParentContext } from './runtime-context.mjs';

const configFile=process.env.FAMILY_TUTOR_CONFIG;
if(!configFile) throw new Error('FAMILY_TUTOR_CONFIG is required');
const config=loadConfig(configFile);
const discordToken=process.env.DISCORD_BOT_TOKEN?.trim()||'';
if(!discordToken) throw new Error('DISCORD_BOT_TOKEN is required when discord.mode=local');

const instanceDir=path.resolve(path.dirname(config.configPath),'..');

const setupGreetingFile=path.join(instanceDir,'.setup-greetings.json');
const bootstrapControlPort=Number(process.env.FAMILY_TUTOR_BOOTSTRAP_PORT||43118);
let bootstrapControlServer=null;

function titleFromChannel(name){
  return String(name||'').split(/[-_ ]+/).filter(Boolean).map(part=>part.slice(0,1).toUpperCase()+part.slice(1)).join(' ');
}
function discoverFamilyFromGuild(guild){
  const text=[...guild.channels.cache.values()]
    .filter(channel=>channel.type===ChannelType.GuildText)
    .sort((a,b)=>(a.rawPosition??a.position??0)-(b.rawPosition??b.position??0)||a.name.localeCompare(b.name));
  const exactParent=/^(?:parents?|parent[-_ ]?(?:chat|room|channel)?)$/i;
  const parent=text.find(channel=>exactParent.test(channel.name))||text.find(channel=>/parent/i.test(channel.name))||null;
  const reserved=/^(?:general|random|welcome|rules|announcements?|bot|bots?|tutor|family-tutor)$/i;
  const sameCategory=parent?.parentId?text.filter(channel=>channel.parentId===parent.parentId):text;
  let candidates=sameCategory.filter(channel=>channel.id!==parent?.id&&!reserved.test(channel.name)&&!/parent/i.test(channel.name));
  if(!candidates.length&&sameCategory!==text) candidates=text.filter(channel=>channel.id!==parent?.id&&!reserved.test(channel.name)&&!/parent/i.test(channel.name));
  const children=candidates.map(channel=>({
    id:childIdFromName(channel.name),
    name:titleFromChannel(channel.name),
    channelId:channel.id,
    channelName:channel.name,
  })).filter(child=>child.id);
  return {
    discovery:parent&&children.length?'automatic':'needs_review',
    parent:parent?{channelId:parent.id,channelName:parent.name}:null,
    children,
  };
}
function applyDiscoveredFamily(family){
  if(family.discovery!=='automatic') return false;
  const existing=new Map(config.children.map(child=>[child.id,child]));
  config.discord={...(config.discord||{}),parentChannelId:family.parent.channelId};
  config.children=family.children.map(child=>({
    ...(existing.get(child.id)||{}),
    id:child.id,
    name:existing.get(child.id)?.name||child.name,
  }));
  persistConfig();
  return true;
}
function logicalFamily(family){
  return {
    discovery:family.discovery,
    parent:family.parent?{channelName:family.parent.channelName}:null,
    children:family.children.map(child=>({id:child.id,name:child.name,channelName:child.channelName})),
  };
}
function loadGreetingState(){ try{return JSON.parse(fs.readFileSync(setupGreetingFile,'utf8'));}catch{return {parent:false,children:{}};} }
function saveGreetingState(state){ const tmp=`${setupGreetingFile}.tmp`; fs.writeFileSync(tmp,`${JSON.stringify(state,null,2)}\n`,{mode:0o600}); fs.renameSync(tmp,setupGreetingFile); }
async function discordSetupStatus(){
  let parent=null;
  try{ parent=await client.channels.fetch(config.discord.parentChannelId); }catch{}
  const guild=parent?.guild||null;
  if(guild) await guild.channels.fetch();
  const children=config.children.map(child=>{
    const channel=guild?.channels?.cache?.find(candidate=>candidate.type===ChannelType.GuildText&&candidate.name===child.id)||null;
    return {id:child.id,name:child.name,channelReady:Boolean(channel)};
  });
  const parentReady=Boolean(parent?.isTextBased?.());
  return {discordReady:parentReady&&children.length>0&&children.every(child=>child.channelReady),parentReady,children};
}
async function sendSetupGreetings(){
  const status=await discordSetupStatus();
  if(!status.discordReady) throw new Error('Discord channels are not ready yet.');
  const state=loadGreetingState();
  const parent=await client.channels.fetch(config.discord.parentChannelId);
  const guild=parent.guild;
  for(const child of config.children){
    if(state.children?.[child.id]) continue;
    const channel=guild.channels.cache.find(candidate=>candidate.type===ChannelType.GuildText&&candidate.name===child.id);
    if(!channel?.isTextBased()) throw new Error(`Discord channel for ${child.name} is not ready yet.`);
    await channel.send(`Hi ${child.name}! 👋 Family Tutor is ready. Ask homework questions here, or send a photo, file, or voice message. I’ll reply in this channel.`);
    state.children={...(state.children||{}),[child.id]:true};
    saveGreetingState(state);
  }
  if(!state.parent){
    const example=config.children[0]?.id||'sammy';
    await parent.send(`Family Tutor is ready. 👋 Use this channel to check learning status or send reminders. Try \`how is #${example} doing?\` or \`remind #${example} to do homework\`.`);
    state.parent=true; saveGreetingState(state);
  }
  return {alreadyComplete:Boolean(state.parent&&config.children.every(child=>state.children?.[child.id])),greetingsSent:true};
}
function childIdFromName(name){
  return String(name||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,60);
}
function persistConfig(){
  const serializable={...config};
  delete serializable.configPath;
  const tmp=`${config.configPath}.tmp`;
  fs.writeFileSync(tmp,`${JSON.stringify(serializable,null,2)}\n`,{mode:0o600});
  fs.renameSync(tmp,config.configPath);
}
async function addKid({name}){
  const clean=String(name||'').trim();
  if(!clean) throw new Error('Kid name is required.');
  const id=childIdFromName(clean);
  if(!id) throw new Error('Please use a name with letters or numbers.');
  if(config.children.some(child=>child.id===id||child.name.toLowerCase()===clean.toLowerCase())) throw new Error('That kid is already in Family Tutor.');
  const parent=await client.channels.fetch(config.discord.parentChannelId);
  if(!parent?.guild) throw new Error('Could not add kid right now.');
  const existing=parent.guild.channels.cache.find(channel=>channel.type===ChannelType.GuildText&&channel.name===id);
  if(!existing){
    await parent.guild.channels.create({name:id,type:ChannelType.GuildText,parent:parent.parentId||undefined,reason:`Family Tutor kid ${clean}`});
  }
  const child={id,name:clean};
  config.children.push(child);
  persistConfig();
  return child;
}
async function deleteKid({childId}){
  const index=config.children.findIndex(child=>child.id===childId);
  if(index<0) throw new Error('Kid was not found.');
  config.children.splice(index,1);
  persistConfig();
  return {childId};
}
const queues=new Map();
const deliveries=new DiscordDeliveryRegistry();
const client=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMessages,GatewayIntentBits.MessageContent]});
let familyGuildId=null;
let tutorClient=null;

function turnPrompt(child,message,correlationId=null){ return buildKidContext({childName:child.name,text:message,correlationId}); }
function collectAttachments(message){
  return [...message.attachments.values()].slice(0,4).map(a=>({
    url:a.url,
    name:a.name||`attachment-${a.id}`,
    mimeType:a.contentType||'',
    size:Number(a.size||0),
  }));
}
async function replyToMessage(message,text){
  let remaining=String(text||'').trim();
  let first=true;
  let sent=null;
  while(remaining){
    let split=remaining.length>1900?remaining.lastIndexOf('\n',1900):remaining.length;
    if(split<800&&remaining.length>1900) split=1900;
    const chunk=remaining.slice(0,split);
    sent=first?await message.reply({content:chunk,failIfNotExists:false})
              :await message.channel.send(chunk);
    remaining=remaining.slice(split).trimStart(); first=false;
  }
  return sent;
}
async function handleTutorChildMessage(message,child){
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
      console.error(`[family-tutor] ${child.id} ASR failed`,error);
      return message.reply('I received your voice message, but I could not transcribe it. Please try again or send it as text.');
    }
  }
  const voiceBlock=voiceTranscript?`[VOICE MESSAGE TRANSCRIPT — preserve the student's spoken meaning; do not judge grammar or writing quality from this transcript]
${voiceTranscript}
[/VOICE MESSAGE TRANSCRIPT]`:'';
  const studentMessage=[incoming,voiceBlock].filter(Boolean).join('\\n\\n') || 'Please help me understand the attached file(s).';
  const correlationId=deliveries.register(text=>replyToMessage(message,text));
  await tutorClient.enqueue({
    learner:child.id,
    prompt:turnPrompt(child,studentMessage,correlationId),
    attachments:nonAudioAttachments,
  });
}

async function resolveMentionedChild(command){
  if(!command?.channelMentionId) return null;
  const channel=await client.channels.fetch(command.channelMentionId);
  const child=findChildByChannelName(config.children,channel?.name);
  if(!child) throw new Error('Family Tutor configuration error: Discord channel #' + (channel?.name||command.channelMentionId) + ' must match ChatGPT Project ' + childProjectName(channel?.name||'') + '.');
  validateChildChannel(child,channel);
  return child;
}
const FAMILY_TUTOR_SKILL_ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const LEARNER_PROFILE_TEMPLATE_FILE=path.join(FAMILY_TUTOR_SKILL_ROOT,'setup','learner-profile-template.md');
const BOOTSTRAP_FILE=path.join(FAMILY_TUTOR_SKILL_ROOT,'bootstrap','latest.md');

function readCanonicalTutorAssets(){
  const profileTemplate=fs.readFileSync(LEARNER_PROFILE_TEMPLATE_FILE,'utf8').trim();
  const bootstrap=fs.readFileSync(BOOTSTRAP_FILE,'utf8').trim();
  if(!profileTemplate||!bootstrap) throw new Error('Family Tutor canonical setup assets are missing');
  return {profileTemplate,bootstrap};
}

async function tutorProjectInstructions(child){
  const {profileTemplate,bootstrap}=readCanonicalTutorAssets();
  const value=(field,fallback='Not specified')=>{
    const raw=String(field??'').trim();
    return raw||fallback;
  };
  const profile=profileTemplate
    .replaceAll('<STUDENT_NAME>',value(child.name,child.id))
    .replaceAll('<NAME>',value(child.name,child.id))
    .replaceAll('<PREFERRED_NAME>',value(child.preferredName||child.name,child.id))
    .replaceAll('<GRADE_OR_LEVEL>',value(child.grade||child.level))
    .replaceAll('<LEVEL>',value(child.grade||child.level))
    .replaceAll('<LANGUAGE>',value(child.language))
    .replaceAll('<INTERESTS>',value(child.interests))
    .replaceAll('<INTEREST>',value(child.interests))
    .replaceAll('<STRENGTHS>',value(child.strengths))
    .replaceAll('<LEARNING_GOALS>',value(child.learningGoals||child.goals))
    .replaceAll('<GOAL>',value(child.learningGoals||child.goals))
    .replaceAll('<PREFERENCE>',value(child.learningPreferences||child.preferences))
    .replaceAll('<PARENT_PREFERENCE>',value(child.parentPreferences||child.boundaries))
    .replaceAll('<SUBJECT>',value(child.subjects||child.courses));
  return `${profile}\n\n---\n\n${bootstrap}`;
}

function ensureTutorLearners(status){
  return requireConfiguredLearners(config.children,status);
}

async function finalizeBootstrapForGuild({guildId,sessionId}){
  if(!client.isReady()) throw new Error('Discord client is not ready yet.');
  let resolvedGuildId=String(guildId||'').trim();
  if(!resolvedGuildId && config.discord?.parentChannelId){
    const parent=await client.channels.fetch(config.discord.parentChannelId);
    resolvedGuildId=String(parent?.guild?.id||'');
  }
  if(!resolvedGuildId) throw new Error('Discord guild id is unavailable.');
  const guild=await client.guilds.fetch(resolvedGuildId);
  await guild.channels.fetch();
  const family=discoverFamilyFromGuild(guild);
  if(family.discovery!=='automatic'){
    return {status:'needs_review',sessionId,family:logicalFamily(family)};
  }
  applyDiscoveredFamily(family);
  let bindings=[];
  if(tutorClient){
    const status=await tutorClient.status();
    bindings=await ensureTutorLearners(status);
  }
  const greetings=await sendSetupGreetings();
  return {
    status:'ready',
    sessionId,
    family:logicalFamily(family),
    learners:bindings.map(binding=>({learner:binding.learner,projectReady:Boolean(binding.project_id&&binding.thread_id)})),
    greetings,
  };
}

function startBootstrapControl(){
  if(bootstrapControlServer) return bootstrapControlServer;
  bootstrapControlServer=http.createServer(async(req,res)=>{
    const url=new URL(req.url||'/',`http://${req.headers.host||'127.0.0.1'}`);
    const send=(status,body)=>{const text=JSON.stringify(body);res.writeHead(status,{'content-type':'application/json; charset=utf-8','content-length':Buffer.byteLength(text),'cache-control':'no-store'});res.end(text);};
    if(req.method==='POST'&&url.pathname==='/discord/reply'){
      let raw=''; for await(const chunk of req){raw+=chunk;if(raw.length>64*1024){res.destroy();return;}}
      try{
        const input=JSON.parse(raw);
        const receipt=await deliveries.deliver({correlationId:input.correlationId,text:input.text});
        return send(200,receipt);
      }catch(error){return send(400,{ok:false,error:String(error?.message||error)});}
    }
    if(req.method==='GET'&&url.pathname==='/health'){
      let discordReady=false;
      try{ discordReady=client.isReady()&&Boolean(familyGuildId)&&(await discordSetupStatus()).discordReady; }
      catch(error){ console.error('[family-tutor] Discord channel health failed',error); }
      let tutorReady=false;
      try{
        const status=await tutorClient?.status();
        tutorReady=Boolean(tutorClient?.started) && config.children.every(child=>
          status?.bindings?.some(binding=>binding.learner===child.id && binding.project_id && binding.thread_id));
      }catch(error){ console.error('[family-tutor] tutor health failed',error); }
      return send(discordReady&&tutorReady?200:503,{ok:discordReady&&tutorReady,discordReady,tutorReady,service:'family-tutor'});
    }
    if(req.method==='POST'&&url.pathname==='/bootstrap/discover'){
      let raw=''; for await(const chunk of req){raw+=chunk;if(raw.length>256*1024){res.destroy();return;}}
      try{
        const body=raw?JSON.parse(raw):{};
        const result=await finalizeBootstrapForGuild({guildId:body.guild_id||'',sessionId:body.session_id||null});
        return send(result.status==='ready'?200:409,result);
      }catch(error){
        console.error('[family-tutor] bootstrap discovery failed',error);
        return send(500,{error:String(error?.message||error)});
      }
    }
    return send(404,{error:'not_found'});
  });
  bootstrapControlServer.listen(bootstrapControlPort,'127.0.0.1',()=>console.log(`[family-tutor-orchestrator] bootstrap control listening on http://127.0.0.1:${bootstrapControlPort}`));
  return bootstrapControlServer;
}

async function runParentTurn(message,child,prompt,{attachments=[]}={}){
  const correlationId=deliveries.register(text=>replyToMessage(message,text));
  return tutorClient.enqueue({
    learner:child.id,
    prompt:buildParentContext({text:prompt,correlationId}),
    attachments,
  });
}

async function handleParentControl(message){
  if(!isAuthorizedParent(message,config)) return;
  const command=parseParentMessage(message.content,config.children);
  if(!command) return message.reply('Mention one child channel naturally, for example: `how is #sammy doing recently?`');
  const child=await resolveMentionedChild(command);
  if(!child) return message.reply('Mention one configured child channel.');
  const attachments=collectAttachments(message);
  const audioAttachments=attachments.filter(isAudioAttachment);
  const nonAudioAttachments=attachments.filter(a=>!isAudioAttachment(a));
  let voiceTranscript=null;
  if(audioAttachments.length) voiceTranscript=await transcribeAudioAttachments(audioAttachments);
  const normalizedMessage=renderParentNaturalText(message.content,command.channelMentionId,child.id,command.channelMentionId);
  const contextMessage=[normalizedMessage,voiceTranscript].filter(Boolean).join('\n\n');
  if(!contextMessage && !nonAudioAttachments.length) return message.reply('Please include the question or guidance.');
  const prompt=buildParentContextPrompt({text:contextMessage});
  return runParentTurn(message,child,prompt,{attachments:nonAudioAttachments});
}

async function handleStatusInteraction(interaction){
  if(!canUseStatus({channelId:interaction.channelId},config)) return interaction.reply({content:statusDenialMessage(),ephemeral:true});
  const requested=interaction.options.getChannel('child-channel');
  let child=null;
  if(requested){
    child=findChildByChannelName(config.children,requested.name);
    if(!child) return interaction.reply({content:'Configuration error: #'+requested.name+' must map to '+childProjectName(requested.name)+'.',ephemeral:true});
    try{validateChildChannel(child,requested);}catch(error){return interaction.reply({content:error.message,ephemeral:true});}
  }
  await interaction.deferReply();
  let first=true;
  for(const target of child?[child]:config.children){
    const correlationId=deliveries.register(async text=>{
      if(first){first=false;return interaction.editReply(text);}
      return interaction.followUp(text);
    });
    await serialize(target.id,()=>tutorClient.enqueue({
      learner:target.id,
      prompt:buildParentContext({text:buildSlashStatusPrompt({child:target,memory:''}),correlationId}),
    }));
  }
}

async function syncSlashCommands(applicationId){
  const rest=new REST({version:'10'}).setToken(discordToken);
  const command=new SlashCommandBuilder().setName(statusCommand.name).setDescription(statusCommand.description).addChannelOption(option=>option.setName('child-channel').setDescription('Child channel, e.g. #sammy').setRequired(false));
  await rest.put(Routes.applicationCommands(applicationId),{body:[command.toJSON()]});
}

function serialize(childId,work){ const prev=queues.get(childId)||Promise.resolve(); const next=prev.catch(()=>{}).then(work).finally(()=>{if(queues.get(childId)===next) queues.delete(childId)}); queues.set(childId,next); return next; }

client.once(Events.ClientReady,async c=>{
  try{
    const parent=await client.channels.fetch(config.discord.parentChannelId);
    familyGuildId=parent?.guildId||null;
    if(!familyGuildId) throw Error('configured parent channel is not in an accessible guild');
  }catch(error){console.error('[family-tutor] parent channel authorization unavailable',error);}
  console.log(`[family-tutor-orchestrator] ready as ${c.user.tag}`);
  syncSlashCommands(c.user.id).then(()=>console.log('[family-tutor-orchestrator] /status command synced')).catch(error=>console.error('[family-tutor] slash command sync failed',error));
});
client.on(Events.InteractionCreate,interaction=>{
  if(!interaction.isChatInputCommand()||interaction.commandName!==statusCommand.name) return;
  handleStatusInteraction(interaction).catch(error=>{
    console.error('[family-tutor] /status failed',error);
    const reply={content:'Status is temporarily unavailable. Please try again shortly.',ephemeral:true};
    if(interaction.deferred||interaction.replied) interaction.editReply(reply).catch(()=>{}); else interaction.reply(reply).catch(()=>{});
  });
});
client.on(Events.MessageCreate,message=>{
  if(message.author.bot || !familyGuildId || message.guildId!==familyGuildId) return;
  const child=findChildByChannelName(config.children,message.channel?.name);
  if(child){
    try{validateChildChannel(child,message.channel);}catch(error){console.error('[family-tutor] child channel configuration error',error); message.reply(error.message).catch(()=>{}); return;}
    reactToReceivedChildMessage(message,child.id);
    serialize(child.id,()=>handleTutorChildMessage(message,child)).catch(error=>{console.error(`[family-tutor] ${child.id} turn failed`,error); message.reply('The tutor is temporarily unavailable. Please try again shortly.').catch(()=>{});});
    return;
  }
  if(config.discord.parentChannelId && message.channelId===config.discord.parentChannelId){
    const command=parseParentMessage(message.content,config.children);
    const key=command?.channelMentionId||'parent-control';
    serialize(key,()=>handleParentControl(message)).catch(error=>{console.error('[family-tutor] parent control failed',error); message.reply(error.message.includes('configuration error')?error.message:'Parent control is temporarily unavailable.').catch(()=>{});});
  }
});
if(config.browserWorkspace?.enabled){
  tutorClient=new BrowserWorkspaceTutorClient({
    instanceDir,
    workspace:config.browserWorkspace.workspace||'Tutor',
  });
  const status=await tutorClient.status();
  const bindings=await ensureTutorLearners(status);
  await tutorClient.startQueue();
  console.log(`[family-tutor-orchestrator] Browser Workspace Tutor ready in ${config.browserWorkspace.workspace||'Tutor'} with ${bindings.length} learner binding(s) and long-lived learner sessions`);
}
startBootstrapControl();
console.log('[family-tutor] Discord transport: local gateway');
for(const signal of ['SIGINT','SIGTERM']){
  process.once(signal,async()=>{
    try{ await tutorClient?.stop(); }catch(error){ console.error('[family-tutor] Browser Workspace Tutor shutdown failed',error); }
    try{ bootstrapControlServer?.close(); }catch{}
    client.destroy();
    process.exit(0);
  });
}
await client.login(discordToken);
