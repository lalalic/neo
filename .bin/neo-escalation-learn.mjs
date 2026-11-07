import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline/promises';
import {stdin as input, stdout as output} from 'node:process';
import {mkdtempSync, openSync, closeSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  localEscalationConfig, serverArguments, freeTcpPort, ready, terminate,
} from './neo-local-escalation.mjs';
import {executeStatelessTool} from './neo-stateless-agent.mjs';
import {
  prepareTaughtExperience, storeTaughtExperience, sanitizeLesson,
} from './neo-escalation-experience.mjs';

const CHAT_INSTRUCTIONS = `You are the Neo local Escalation agent learning directly from the owner.
The owner describes a scenario and how to solve it. Immediately try the steps
with available tools; show what you do. Do not ask a checklist of questions.
If a step fails or the owner corrects you, adjust and retry.
Once the actual task is complete, verify it with tool evidence.
Only end your answer with [VERIFIED] if a real tool confirmed success.
Otherwise state the blocker briefly and wait for the owner's correction.
Never claim success without evidence or save anything yourself.
Operate only within authorized scope; respect consent and safety boundaries.
When using WebHelm, read webhelm help and the relevant subcommand help
before acting; webhelm connector is not a supported command.
WebHelm platform actions ONLY exist for names returned by webhelm platform list.
If the site is not in that list, never call webhelm platform profile, source or run
for it. Use a browser Session instead: start with --url only when needed; reuse
your previous session_id for session exec, passing JavaScript using the code field.
Begin with console.log(await page_info()) and console.log(await snapshot()).
If the login form is a cross-origin iframe omitted from snapshot, inspect the
iframe and switch to Neo Computer Use as needed. Reuse the same authenticated
Chrome, and never stop sessions you did not create.
Do not repeat a failed identical tool call. Inspect the error and change approach.
For the owner's Apple App Store Connect login, USER_ACCOUNTS and USER_PASSWORDS
are available in the local environment. Use credential_fill with the authorized
WebHelm session ID to fill both fields securely. Do not print, log, or paste
the values into chat, model messages, or browser JavaScript yourself.
Then inspect the Apple iframe with CDP via WebHelm session exec, submit the
observed Continue control, and verify the resulting page. If Apple requires
two-factor verification or another owner-only step, explain it and wait
without attempting to bypass it.
Never guess a command or use a blank tab to replace an existing site.
Keep replies short and in the owner's language.`;

const SUMMARY_INSTRUCTIONS = `Extract one reusable escalation troubleshooting lesson from this owner-led teaching conversation.
Respond with exactly ONE JSON object (no markdown or explanatory text) with:
{"scenario_key":"short.stable_key","category":"authentication|permissions|browser|desktop|shell|network|tooling|human|runtime|other","symptom":"generalized symptom","strategy_key":"short.stable_key","steps":["ordered reproducible instruction"],"verification":"how to verify it, or 'Not verified; owner described procedure'","failure_reason":"","lesson":"key principle"}.
Record the COMPLETE successful login process the owner taught, not just the final read-only verification. Include the secure credential_fill tool and cross-origin iframe steps when actually observed or owner-confirmed; omit ephemeral session IDs and the [VERIFIED] marker as instructions. Do not invent steps, evidence, verification or technical details. Distinguish owner
instruction from observed tool evidence. Avoid secrets, raw credentials, account IDs,
private paths, raw URLs and ephemeral values. Summarize a single scenario, not unrelated topics.
If there is insufficient detail, use empty steps, not guesses.`;

function jsonAnswer(payload) {
  const message=payload?.choices?.[0]?.message;
  if (!message || typeof message !== 'object') throw Error('The local model returned no assistant message');
  return message;
}

export async function callLocalModel(baseUrl, messages, {
  askModel=fetch, tools=[], maxTokens=1400, temperature=0.2, json=false,
}={}) {
  if (!/^http:\/\/127\.0\.0\.1:\d+\/v1$/.test(baseUrl || '')) throw Error('Local loopback inference endpoint required');
  const options={model:'neo-escalation',messages,temperature,max_tokens:maxTokens,
    stream:false,chat_template_kwargs:{enable_thinking:false}};
  if(tools.length) {options.tools=tools;options.tool_choice='auto';}
  if(json) options.response_format={type:'json_object'};
  let response;
  try {
    response=await askModel(baseUrl+'/chat/completions',{
      method:'POST',redirect:'error',headers:{'content-type':'application/json'},
      body:JSON.stringify(options),signal:AbortSignal.timeout(180000),
    });
  } catch(error) {throw new Error('Learning session model request failed: '+error.message);}
  if(!response.ok) throw Error('Learning session model HTTP '+response.status);
  return jsonAnswer(await response.json());
}

// Keep the learning conversation in memory, including tool observations.
// The normal Escalation executor remains stateless and has a different contract.
export function createLearningConversation({cwd=process.cwd(), askModel=fetch, callTool=executeStatelessTool}={}) {
  const messages=[{role:'system',content:CHAT_INSTRUCTIONS}];
  let toolsEnabled=true;
  const observations=[];
  const failedCalls=new Set();
  const toolSpecs=[
    {type:'function',function:{name:'shell',description:'Execute an authorized local shell inspection or action',
      parameters:{type:'object',properties:{command:{type:'string'}},required:['command']}}},
    {type:'function',function:{name:'webhelm',description:'WebHelm browser CLI. For an existing browser session use args ["session","exec","SESSION_ID"] with code "console.log(await snapshot());" or "console.log(await page_info());". JavaScript code MUST be passed in the separate code parameter. Never use platform actions for sites absent from "webhelm platform list". To inspect a cross-origin iframe, consider Neo Computer Use if WebHelm snapshot omits its contents.',
      parameters:{type:'object',properties:{args:{type:'array',items:{type:'string'}},code:{type:'string',description:'JavaScript for session exec ID, sent to WebHelm through stdin'}},required:['args']}}},
    {type:'function',function:{name:'credential_fill',description:'For owner-authorized App Store Connect login, securely fill account and password from local USER_ACCOUNTS and USER_PASSWORDS in an existing WebHelm session. Call with {session_id}. Never print or request plaintext secrets. This tool fills only; you must inspect and submit the login separately.',parameters:{type:'object',properties:{session_id:{type:'string'}},required:['session_id']}}},
    {type:'function',function:{name:'computer_use',description:'Use Neo Computer Use CLI',
      parameters:{type:'object',properties:{command:{type:'string'},args:{type:'object'}},required:['command']}}},
  ];
  return {
    messages,observations,
    setTools(value) {toolsEnabled=Boolean(value);},
    get toolsEnabled() {return toolsEnabled;},
    async say(baseUrl,text,write=()=>{}) {
      if(!text.trim()) return '';
      messages.push({role:'user',content:text});
      while(true){
        const message=await callLocalModel(baseUrl,messages,{
          askModel,tools:toolsEnabled?toolSpecs:[],
        });
        const calls=Array.isArray(message.tool_calls)?message.tool_calls:[];
        if(!calls.length){
          const answer=String(message.content||'').trim();
          messages.push({role:'assistant',content:answer});
          return answer;
        }
        if(!toolsEnabled) throw Error('The local model attempted tools without /tools on');
        // Respond to every model tool call; do not truncate batches or interrupt exploration.
        messages.push({role:'assistant',content:message.content||null,tool_calls:calls});
        for(const call of calls) {
          let args={};
          try {args=typeof call.function.arguments==='string'?
            JSON.parse(call.function.arguments):call.function.arguments||{};}
          catch {throw Error('Malformed local agent tool arguments');}
          write('  [tool] '+String(call.function.name).slice(0,40));
          let result;
          const key=JSON.stringify({name:call.function.name,args});
          if(failedCalls.has(key)){
            result={ok:false,text:'This exact command already failed. Do not retry it. Inspect the previous error and choose another supported tool or browser Session action.'};
          } else {
            try {result=await callTool(call.function.name,args,{cwd});}
            catch(error) {result={ok:false,text:error.message};}
            if(!result.ok) failedCalls.add(key);
          }
          const observation={name:call.function.name,ok:Boolean(result.ok),text:String(result.text||''),
            action:sanitizeLesson(JSON.stringify({name:call.function.name,args}),250)};
          observations.push(observation);
          write('    '+(observation.ok?'ok':'failed')+
            (observation.text?' · '+sanitizeLesson(observation.text,180):''));
          messages.push({role:'tool',tool_call_id:call.id,
            content:JSON.stringify({ok:observation.ok,output:observation.text.slice(-12000)})});
        }
      }
    },
    async draft(baseUrl) {
      if(messages.length<=1) throw Error('Teach a scenario before /remember');
      // Never include a previous draft in the conversation. No transcript is stored.
      const message=await callLocalModel(baseUrl,[
        {role:'system',content:SUMMARY_INSTRUCTIONS},
        {role:'user',content:JSON.stringify({
          conversation:messages.slice(1).filter(m=>m.role==='user' || m.role==='assistant').map(m=>({
            role:m.role,content:String(m.content||'').slice(0,6000),
          })).slice(-40),
          actual_tools:observations.map(o=>({action:o.action,ok:o.ok})).slice(-24),
        })},
      ],{askModel,maxTokens:2200,temperature:0,json:true});
      const raw=String(message.content||'').trim().replace(/^\x60\x60\x60(?:json)?\s*|\x60\x60\x60$/g,'');
      let candidate;
      try {candidate=JSON.parse(raw);} catch {throw Error('Local model returned invalid lesson JSON; continue teaching and retry /remember');}
      if(!candidate || !Array.isArray(candidate.steps) || !candidate.steps.length ||
          !candidate.scenario_key || !candidate.strategy_key || !candidate.lesson) {
        throw Error('Lesson is missing scenario, strategy, steps or principle; provide details then retry /remember');
      }
      return candidate;
    },
  };
}

export function previewTaughtLesson(record) {
  return [
    'Scenario: '+record.scenario.symptom,
    'Category: '+record.scenario.category,
    'Scenario key: '+record.scenario.key,
    'Strategy key: '+record.strategy.key,
    ...record.strategy.steps.map((step,i)=>`  ${i+1}. ${step}`),
    'Verify: '+record.strategy.verification,
    'Principle: '+record.strategy.lesson,
  ].join('\n');
}

export async function withLearningModel(run,{
  config=localEscalationConfig(), spawnServer=spawn,
  portFactory=freeTcpPort, fetcher=fetch, onServerStarted=()=>{},
}={}) {
  const temp=mkdtempSync(join(tmpdir(),'neo-escalation-learn-'));
  let server=null;
  let stopRequested=false;
  const stop=()=>{
    stopRequested=true;
    if(server && server.exitCode===null && server.signalCode===null) server.kill('SIGTERM');
  };
  process.once('SIGTERM',stop);
  process.once('SIGINT',stop);
  try {
    let baseUrl=config.baseUrl;
    if(config.engine!=='external'){
      const port=await portFactory();
      const logFd=openSync(join(temp,'server.log'),'w',0o600);
      try {
        server=spawnServer(config.serverCommand,serverArguments(config,port),{
          cwd:temp,stdio:['ignore',logFd,logFd],env:process.env,
        });
      } finally {closeSync(logFd);}
      if(Number.isInteger(server.pid)) onServerStarted(server.pid);
      let startupError;
      server.once('error',err=>{startupError=err;});
      await ready(port,server,config.startupMs,fetcher,()=>startupError);
      baseUrl=`http://127.0.0.1:${port}/v1`;
    }
    if(stopRequested) throw Error('Learning session terminated');
    return await run(baseUrl);
  } finally {
    await terminate(server);
    process.removeListener('SIGTERM',stop);
    process.removeListener('SIGINT',stop);
    rmSync(temp,{recursive:true,force:true,maxRetries:15,retryDelay:150});
  }
}

export async function runLearningSession({
  inputStream=input, outputStream=output, config=localEscalationConfig(),
  askModel=fetch, callTool=executeStatelessTool, onServerStarted=()=>{},
  modelRunner=withLearningModel, cwd=process.cwd(),
}={}) {
  if(!inputStream.isTTY && inputStream===input) {
    throw Error('neo escalation learn requires a terminal (TTY). Open Terminal or use Neo terminal.start.');
  }
  const rl=createInterface({input:inputStream,output:outputStream,terminal:Boolean(inputStream.isTTY)});
  // Ctrl-C cancels the interactive conversation instead of leaving an orphan model.
  rl.on('SIGINT',()=>rl.close());
  const onTerminate=()=>rl.close();
  process.once('SIGTERM',onTerminate);
  const say=(text)=>outputStream.write(text+'\n');
  let conversation=createLearningConversation({cwd,askModel,callTool});
  const ask=async text=>{
    try {return await rl.question(text);} catch(error) {
      if(error.code==='ERR_USE_AFTER_CLOSE') return null;
      throw error;
    }
  };
  try {
    say('Neo Escalation Learn — local model, private in-memory conversation.');
    say('Give a scenario and steps. The agent tries them, verifies, then records automatically.');
    say('Commands: /quit (exit); /remember (optional manual save); /tools off (disable tools).');
    await modelRunner(async baseUrl=>{
      while(true){
        let line=await ask('You> ');
        if(line===null) break;
        line=line.trim();
        if(!line) continue;
        if(line==='/quit' || line==='/exit') break;
        if(line==='/help') {say('Describe the scenario and steps, then correct failures. Auto-save follows verified success. /quit exits.');continue;}
        if(line==='/tools on' || line==='/tools off') {
          conversation.setTools(line==='/tools on');
          say('Local tools '+(conversation.toolsEnabled?'enabled (only within your authorized scope)':'disabled')+'.');
          continue;
        }
        if(line==='/remember') {
          try {
            const candidate=await conversation.draft(baseUrl);
            const record=prepareTaughtExperience(candidate,{model:config.model,engine:config.engine});
            say('\nProposed reusable lesson:\n'+previewTaughtLesson(record));
            say('This is owner-taught guidance, not an independently verified resolution.');
            const confirmation=await ask('Save or update this lesson? [y/N] ');
            if(confirmation?.trim().toLowerCase()==='y' || confirmation?.trim().toLowerCase()==='yes'){
              const saved=storeTaughtExperience(record);
              say((saved.updated?'Updated':'Saved')+' lesson '+record.scenario.key+' ('+record.id.slice(0,12)+').');
            } else say('Not saved. Continue teaching or /quit.');
          } catch(error){say('Could not save lesson: '+error.message);}
          continue;
        }
        if(line.startsWith('/')) {say('Unknown command. Type /help.');continue;}
        try {
          const response=await conversation.say(baseUrl,line,text=>say(text));
          say('Agent> '+response);
          if(/\[VERIFIED\]/.test(response) && conversation.observations.some(o=>o.ok)){
            const start=conversation.observations.length;
            say('Checking independently before recording...');
            const checked=await conversation.say(baseUrl,
              'Perform a NEW read-only tool check proving the original scenario is resolved. '+
              'If and only if the new evidence confirms success, end with [VERIFIED]. '+
              'If the check fails, explain what to correct.',text=>say(text));
            say('Agent> '+checked);
            if(/\[VERIFIED\]/.test(checked) &&
              conversation.observations.slice(start).some(o=>o.ok)){
              const candidate=await conversation.draft(baseUrl);
              const record=prepareTaughtExperience(candidate,{
                model:config.model,engine:config.engine,
              });
              record.tool_verified=true;
              const actual=conversation.observations;
              record.observation={
                tools:[...new Set(actual.map(o=>o.name))],
                calls:actual.length,
                failures:actual.filter(o=>!o.ok).length,
              };
              const fresh=actual.slice(start).find(o=>o.ok);
              record.verification_evidence=sanitizeLesson(fresh?.text,240);
              storeTaughtExperience(record);
              say('Verified and recorded: '+record.scenario.key);
              conversation=createLearningConversation({cwd,askModel,callTool});
            } else say('Not verified; describe a correction to retry.');
          }
        } catch(error) {say('Agent error: '+error.message);}
      }
    },{config,onServerStarted});
    say('Learning session ended. Conversation discarded.');
  } finally {
    process.removeListener('SIGTERM',onTerminate);
    rl.close();
  }
}
