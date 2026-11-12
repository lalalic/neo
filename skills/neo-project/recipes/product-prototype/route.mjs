#!/usr/bin/env node
/**
 * Product Prototype recipe: lightweight discussion-first routing.
 * This is NOT the production artifact/QA validator and NOT a scheduler.
 * The existing Relay Agent Task calls this when useful; discussion and rapid
 * prototypes are allowed before code, SHA, Git commits or formal Review.
 */
import {existsSync,readFileSync,realpathSync,statSync} from 'node:fs';
import {resolve,relative,join,dirname,sep,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';

const fail=message=>{throw Error(message)};
const text=value=>typeof value==='string'&&value.trim().length>0;
function inside(parent,child){
  const rel=relative(parent,child);
  return rel!==''&&rel!=='..'&&!rel.startsWith('..'+sep)&&!isAbsolute(rel);
}
export function graphAgents(graph){
  if(!/^\s*flowchart\s+(TD|TB|LR|RL)\s*$/m.test(graph))
    fail('Missing canonical graph.mmd flowchart header');
  const agents=[...graph.matchAll(/\[agent:([a-z][a-z0-9-]*)\]/g)].map(m=>m[1]);
  if(!agents.length||new Set(agents).size!==agents.length)
    fail('Missing or duplicated graph Agent');
  return agents;
}
export function loadRecipe(project){
  const root=realpathSync(resolve(project));
  if(!statSync(root).isDirectory())fail('Project root must be a directory');
  const cfg=JSON.parse(readFileSync(join(root,'config/product-prototype.json'),'utf8'));
  if(cfg.schemaVersion!==1||!text(cfg.product?.name)||!['mobile','web'].includes(cfg.product?.kind))
    fail('Invalid product recipe configuration');
  const transport=cfg.product.kind==='mobile'?'neouse':'webhelm';
  if(cfg.qa?.transport!==transport||!text(cfg.qa?.toolPrefix))
    fail('Invalid product QA configuration');
  const agents=graphAgents(readFileSync(join(root,'graph.mmd'),'utf8'));
  if(cfg.stages!==undefined){
    if(!cfg.stages||Array.isArray(cfg.stages)||typeof cfg.stages!=='object')
      fail('Invalid prototype options');
    for(const [agent,options] of Object.entries(cfg.stages)){
      if(!agents.includes(agent))fail('Prototype hint for non-graph Agent: '+agent);
      if(options?.prototype&&(!['script','agent','service'].includes(options.prototype.executor)||
        !text(options.prototype.entrypoint)))fail('Invalid prototype executor for '+agent);
      if(options?.qaTool!==undefined&&!/^[a-z][a-z0-9_.-]+$/.test(options.qaTool))
        fail('Invalid QA tool for '+agent);
    }
  }
  return {root,cfg,agents};
}
const generation=record=>Number.isSafeInteger(record?.iteration)&&record.iteration>0?
  record.iteration:1;
const matching=(record,iteration)=>record?.iteration===undefined?
  iteration===1:generation(record)===iteration;
export function route({project,run,agent}){
  const {root,cfg,agents}=loadRecipe(project);
  if(!agents.includes(agent))fail('Agent not in graph.mmd: '+agent);
  const runs=realpathSync(join(root,'runs')),current=realpathSync(resolve(run));
  if(!inside(runs,current)||!statSync(current).isDirectory())
    fail('Must use canonical private product Run');
  // Only project/Run containment is required. A local development prototype
  // can be a discussion, sketch, transient UI demo or real media file.
  const relativeRun=relative(runs,current);
  if(!/^\d{4}-\d{2}-\d{2}(?:-[a-z0-9-]+)?(?:\/|$)/.test(relativeRun))
    fail('Use a dated project Run directory');
  const stateFile=join(current,'.product-prototype-gates.json');
  const state=existsSync(stateFile)?JSON.parse(readFileSync(stateFile,'utf8')):null;
  if(state&&(state.schemaVersion!==1||!state.agents||
    typeof state.agents!=='object'||Array.isArray(state.agents)))
    fail('Invalid optional prototype notes');
  const progress=state?.agents[agent]||{};
  const iteration=generation(progress.prototype);
  const tool=cfg.stages?.[agent]?.qaTool||
    cfg.qa.toolPrefix+agent.replace(/^[^-]+-/,'')+'.run';
  const base={schemaVersion:1,project:cfg.product.name,platform:cfg.product.kind,
    agent,run:current,iteration};
  if(!['tried','ready'].includes(progress.prototype?.status)){
    return {...base,step:'prototype',status:'try_prototype',
      next:{executor:cfg.stages?.[agent]?.prototype?.executor||'agent',
        entrypoint:cfg.stages?.[agent]?.prototype?.entrypoint||'Agent-chosen quick prototype',
        action:'Try something quickly on the development host. Discuss, tweak and show the result. No SHA, commit or formal Review required.'}};
  }
  const feedback=progress.ownerReview;
  if(feedback?.decision==='changes_requested'&&matching(feedback,iteration)){
    return {...base,step:'prototype',status:'revise_prototype',
      next:{executor:cfg.stages?.[agent]?.prototype?.executor||'agent',
        entrypoint:cfg.stages?.[agent]?.prototype?.entrypoint||'Agent-chosen quick prototype',
        action:'Use user feedback to quickly change the prototype and show it again.',
        feedback:feedback.notes||''}};
  }
  if(feedback?.decision!=='approved'||!matching(feedback,iteration)){
    return {...base,step:'confirm',status:'discuss_with_user',
      next:{action:'Show the prototype, discuss tradeoffs and ask whether the approach is good enough to implement. A natural chat confirmation is sufficient; managed Review is optional.'}};
  }
  const implementation=progress.productImplementation;
  if(!['working','ready'].includes(implementation?.status)||
    !['native','service'].includes(implementation?.target)||
    !matching(implementation,iteration)){
    return {...base,step:'port',status:'implement_product',
      next:{target:cfg.stages?.[agent]?.preferredTarget||'native-preferred',
        action:'Copy confirmed behavior into mobile/web product where feasible, otherwise implement an authenticated service API; keep the real UI and QA tool on the same implementation.'}};
  }
  const qa=progress.productE2E;
  if(qa?.status!=='passed'||qa.tool!==tool||
    qa.transport!==cfg.qa.transport||!matching(qa,iteration)){
    return {...base,step:'product-e2e',status:'test_actual_product',
      next:{transport:cfg.qa.transport,tool,
        action:cfg.qa.transport==='neouse'?
          'Call the actual App feature through a NeoUse QA session; inspect the real result and UI.' :
          'Use WebHelm on the real site to verify the feature through its actual product behavior.'}};
  }
  return {...base,step:'ready',status:'ready',
    next:{tool,transport:cfg.qa.transport,
      action:'Capability prototype accepted, product implementation done and real product E2E passed.'}};
}
function parseArgs(args){
  const parsed={};
  for(let i=0;i<args.length;i++){
    const key=args[i],value=args[++i];
    if(!['--project','--run','--agent'].includes(key)||!value||value.startsWith('--'))
      fail('Usage: node route.mjs --project ROOT --run PRIVATE_RUN --agent GRAPH_AGENT');
    parsed[key.slice(2)]=value;
  }
  if(!parsed.project||!parsed.run||!parsed.agent)fail('project/run/agent required');
  return parsed;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{console.log(JSON.stringify(route(parseArgs(process.argv.slice(2))),null,2))}
  catch(e){console.error(JSON.stringify({status:'blocked',reason:e.message}));process.exitCode=2}
}
