#!/usr/bin/env node
/** Neo Project capability eval runner. Model decisions and executable tests are distinct. */
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,join,relative,basename,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';

const root=resolve(import.meta.dirname,'..');
const flags=process.argv.slice(2);
const usage=`Usage: neo eval run --project NAME [--case ID | --dag [--smoke]] [--model MODEL] [--profile CODEX_PROFILE] [--reasoning high] [--dry-run]\n       neo eval list --project NAME [--dag]\n       neo eval audit\n\nCases live at <project>/.evals/cases.json; each run saves evidence under <project>/.evals/reports/.\n`;
function options(argv){
 const out={};
 for(let i=0;i<argv.length;i++){
  const flag=argv[i];
  if(flag==='--dry-run'||flag==='--list'||flag==='--help'||flag==='--dag'||flag==='--smoke'){out[flag.slice(2)]=true;continue;}
  if(!['--project','--model','--profile','--reasoning','--case','--adapter'].includes(flag))throw Error('Unknown eval option: '+flag);
  if(out[flag.slice(2)]!==undefined)throw Error('Repeated eval option: '+flag);
  const value=argv[++i];if(!value||value.startsWith('--'))throw Error(flag+' requires a value');
  out[flag.slice(2)]=value;
 }
 return out;
}
const opts=options(flags);
const dryRun=Boolean(opts['dry-run']);
if(opts.reasoning&&!['low','medium','high','xhigh'].includes(opts.reasoning))throw Error('Invalid Codex reasoning effort');
if(opts.profile&&!/^[a-zA-Z0-9_-]+$/.test(opts.profile))throw Error('Invalid Codex profile');
if(opts.profile&&!opts.model)throw Error('Explicit Codex profile requires --model');
if(opts.help){console.log(usage);process.exit(0);}
const project=opts.project||(resolve(process.cwd())!==root?basename(process.cwd()):null);
if(!project||!/^[a-z0-9-]+$/.test(project))throw Error('Specify --project NAME (or run inside a Neo Project)');
const adapter=opts.adapter||'codex';
if(adapter!=='codex')throw Error('Only the locally authenticated Codex adapter is supported');
const projectRoot=resolve(root,project);
if(!existsSync(join(projectRoot,'AGENTS.md')))throw Error('Unknown Neo Project: '+project);
const casePath=join(projectRoot,'.evals','cases.json');
if(!existsSync(casePath))throw Error('NOT_EVALUATED: '+project+' has no .evals/cases.json');
const cases=JSON.parse(readFileSync(casePath,'utf8'));
if(!Array.isArray(cases)||!cases.length)throw Error('Project eval cases must be a nonempty array');
if(new Set(cases.map(c=>c.id)).size!==cases.length)throw Error('Duplicate eval case IDs');
if(opts.dag && opts.case)throw Error('--dag cannot be combined with --case');
if(opts.smoke && !opts.dag)throw Error('--smoke requires --dag');
let dagRoles = null;
if(opts.dag){
 const graphPath=join(projectRoot,'graph.mmd');
 if(!existsSync(graphPath))throw Error('Project DAG eval requires graph.mmd: '+project);
 // Use Relay's authoritative DAG parser. Neo Eval selects roles but does not
 // duplicate graph syntax, dependency logic, or Shortcut Runner implementation.
 const relayCliPath=process.env.AGENTS_RELAY_DIST_CLI || resolve(root,'../agents-relay/dist/cli.js');
 const parserPath=join(dirname(relayCliPath),'agent-graph.js');
 if(!existsSync(parserPath))throw Error('Relay Agent Graph parser unavailable: '+parserPath);
 const {parseAgentGraph}=await import(pathToFileURL(parserPath).href);
 const graph=parseAgentGraph(readFileSync(graphPath,'utf8'));
 dagRoles=[...new Set(graph.nodes.map(node=>node.agent))];
 const missing=dagRoles.filter(role=>!cases.some(c=>c.role===role && (c.type||'decision')==='decision'));
 if(missing.length)throw Error('NOT_EVALUATED: DAG Agent(s) missing decision eval: '+missing.join(', '));
}
const selected = opts.case ? cases.filter(c=>c.id===opts.case)
 : dagRoles ? (opts.smoke ? dagRoles.map(role=>cases.find(c=>c.role===role&&(c.type||'decision')==='decision'))
                          : cases.filter(c=>dagRoles.includes(c.role)))
 : cases;
if(!selected.length)throw Error('Unknown eval case: '+opts.case);
function safeProjectFile(path,base=projectRoot){
 const full=resolve(base,path),rel=relative(projectRoot,full);
 if(!rel||rel==='..'||rel.startsWith('../')||rel.startsWith('..\\')||!existsSync(full))throw Error('Missing/unsafe project file: '+path);
 return full;
}
function roleFile(role){
 if(!/^[a-z0-9-]+$/.test(role))throw Error('Invalid role');
 for(const path of [join(projectRoot,'agents',role+'.agent.md'),join(root,'agents',role+'.agent.md')])if(existsSync(path))return path;
 throw Error('Missing agent role: '+role);
}
function validate(c){
 if(!c.id||!/^[-\w]+$/.test(c.id)||!c.role||!c.capability)throw Error('Invalid case identity');
 roleFile(c.role);
 const type=c.type||'decision';
 if(type==='decision'){
  if(!c.task||!c.expectedDecision||!Array.isArray(c.choices)||c.choices.length<2||!c.choices.includes(c.expectedDecision))throw Error('Invalid decision case: '+c.id);
  for(const path of c.references||[])safeProjectFile(path);
 } else if(type==='node-tests'){
  if(!Array.isArray(c.testFiles)||!c.testFiles.length)throw Error('Missing node test files: '+c.id);
  for(const path of c.testFiles){
   const full=safeProjectFile(path);
   if(!relative(join(projectRoot,'test'),full).match(/^[^./][\w.-]*\.test\.mjs$/))throw Error('Test file must be project test/*.test.mjs: '+path);
  }
 } else throw Error('Unsupported case type: '+type);
 return type;
}
selected.forEach(validate);
if(opts.list){
 console.log(JSON.stringify({project,dagRoles,cases:selected.map(c=>({id:c.id,role:c.role,type:c.type||'decision',capability:c.capability}))},null,2));
 process.exit(0);
}
const reportDir=join(projectRoot,'.evals','reports',new Date().toISOString().replaceAll(':','-')+'-'+randomUUID().slice(0,8));
mkdirSync(reportDir,{recursive:true});
// The real Agents Relay managedWorkerInput Builder is the only author of role prompts.
// Prefer the canonical sibling checkout on Neo Master; deployments can override
// it with the absolute CLI entrypoint of their installed Agents Relay package.
const relayCli=process.env.AGENTS_RELAY_DIST_CLI || resolve(root,'../agents-relay/dist/cli.js');
if(!existsSync(relayCli))throw Error('Relay PromptBuilder CLI unavailable: '+relayCli+'; set AGENTS_RELAY_DIST_CLI');
function builderPrompt(c,scenarioFile,builderOutput){
 const args=[relayCli,'prompt','--eval-file',scenarioFile,'--adapter',adapter,'--output',builderOutput];
 const run=spawnSync(process.execPath,args,{cwd:projectRoot,encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024,env:{...process.env,AGENTS_RELAY_PROMPT_REFERENCE_DIR:join(reportDir,'snapshots')}});
 if(run.status!==0||run.error)throw Error('Relay PromptBuilder failed for '+c.id+': '+(run.error?.message||run.stderr||run.stdout));
 const payload=JSON.parse(readFileSync(builderOutput,'utf8'));
 if(payload.builder!=='managedWorkerInput'||payload.mode!=='isolated-evaluation'||payload.agentName!==c.role||payload.adapter!==adapter||
   !payload.productionPrompt?.includes('## Contracts')||!payload.productionPrompt.includes('## Contexts')||
   !payload.evaluationPrompt?.includes('[Isolated prompt evaluation mode]'))
   throw Error('Relay Builder returned incomplete or mismatched prompt for '+c.id);
 return payload;
}
let failures=0;const results=[];
for(const c of selected){
 const type=validate(c);
 if(type==='node-tests'){
  if(dryRun){results.push({id:c.id,role:c.role,type,status:'DRY_RUN',testFiles:c.testFiles});continue;}
  const result=spawnSync(process.execPath,['--test',...c.testFiles],{cwd:projectRoot,encoding:'utf8',timeout:240000,maxBuffer:16*1024*1024});
  const output=(result.stdout||'')+'\n'+(result.stderr||'');
  writeFileSync(join(reportDir,c.id+'.tests.log'),output);
  const pass=result.status===0&&!result.error;
  if(!pass)failures++;
  results.push({id:c.id,role:c.role,type,status:pass?'PASS':'FAIL',exitCode:result.status,error:result.error?.message||null,testFiles:c.testFiles,log:c.id+'.tests.log'});
  console.log(`${pass?'PASS':'FAIL'} ${c.role}/${c.id} (${c.testFiles.length} executable test files)`);
  continue;
 }
 // The scenario is Task data, not handwritten AGENTS/role/contract bootstrap text.
 const taskInput=`[Neo Project Eval Case: ${c.id}; capability: ${c.capability}]
Evaluate the following simulated Task. Do not carry out real actions. Respond ONLY with
JSON {"decision":"one of the choices","actions":["concrete intended actions"],"reason":"grounded rationale"}.
Choose exactly one decision from: ${c.choices.join(', ')}.
Scenario: ${c.task}
${c.references?.length?'Relevant project contract references (read only if needed): '+c.references.join(', '):''}`;
 const inputFile=join(reportDir,c.id+'.builder-input.json');
 const builderOutput=join(reportDir,c.id+'.builder-output.json');
 writeFileSync(inputFile,JSON.stringify({projectPath:projectRoot,agentName:c.role,caseId:c.id,taskInput},null,2));
 const built=builderPrompt(c,inputFile,builderOutput);
 const prompt=built.evaluationPrompt;
 writeFileSync(join(reportDir,c.id+'.prompt.txt'),prompt);
 writeFileSync(join(reportDir,c.id+'.production.prompt.txt'),built.productionPrompt);
 if(dryRun){results.push({id:c.id,role:c.role,type,status:'DRY_RUN',promptCharacters:prompt.length,builder:built.builder,productionPromptCharacters:built.productionPrompt.length});continue;}
 const args=['exec','--sandbox','read-only','--skip-git-repo-check','-C',projectRoot];
 if(opts.profile)args.push('-p',opts.profile);
 if(opts.model)args.push('--model',opts.model);
 if(opts.reasoning)args.push('-c',`model_reasoning_effort=${opts.reasoning}`);
 args.push('--output-last-message',join(reportDir,c.id+'.response.txt'),'-');
 const run=spawnSync('codex',args,{input:prompt,cwd:projectRoot,encoding:'utf8',timeout:180000,maxBuffer:4*1024*1024});
 const path=join(reportDir,c.id+'.response.txt');
 const output=existsSync(path)?readFileSync(path,'utf8'):(run.stdout||'');
 let parsed=null;
 try{parsed=JSON.parse(output.replace(/^```(?:json)?\s*|\s*```$/g,'').trim());}catch{}
 const responseText=parsed?JSON.stringify(parsed):output;
 const correct=parsed?.decision===c.expectedDecision;
 const required=(c.required||[]).every(x=>responseText.toLowerCase().includes(x.toLowerCase()));
 const forbidden=(c.forbidden||[]).every(x=>!responseText.toLowerCase().includes(x.toLowerCase()));
 const pass=run.status===0&&correct&&required&&forbidden;
 if(!pass)failures++;
 results.push({id:c.id,role:c.role,type,builder:built.builder,status:pass?'PASS':'FAIL',expected:c.expectedDecision,actual:parsed?.decision||null,exitCode:run.status,required,forbidden,error:run.error?.message||null,output:output.slice(0,1600)});
 console.log(`${pass?'PASS':'FAIL'} ${c.role}/${c.id} ${parsed?.decision||'INVALID_OUTPUT'}`);
}
const report={project,dagRoles,dagCoverage:dagRoles?{total:dagRoles.length,selectedRoles:[...new Set(selected.map(c=>c.role))]}:null,adapter,promptSource:'agents-relay/managedWorkerInput',model:opts.model||'codex default',profile:opts.profile||null,reasoning:opts.reasoning||null,mode:dryRun?'dry-run':'mixed',count:results.length,executed:dryRun?0:results.length,passed:results.filter(x=>x.status==='PASS').length,failed:failures,results};
writeFileSync(join(reportDir,'report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({project,dagRoles,mode:report.mode,executed:report.executed,passed:report.passed,failed:failures,report:join(reportDir,'report.json')},null,2));
if(failures)process.exitCode=1;
