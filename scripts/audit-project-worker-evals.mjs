#!/usr/bin/env node
/** Detect omitted project-local worker roles. Missing cases never count as PASS. */
import {readdirSync,readFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=resolve(import.meta.dirname,'..');
const projects=readdirSync(root,{withFileTypes:true}).filter(x=>x.isDirectory()&&existsSync(join(root,x.name,'AGENTS.md'))).map(x=>x.name).sort();
let required=0,covered=0,missing=[],missingManifests=[];
const dagCoverage={};
const parserPath=resolve(root,'../agents-relay/dist/agent-graph.js');
// Neo audits cases and role coverage; Relay remains the owner of graph syntax.
let parseAgentGraph=null;
if(existsSync(parserPath))({parseAgentGraph}=await import(pathToFileURL(parserPath).href));
for(const project of projects){
 const agentRoot=join(root,project,'agents');
 const agents=existsSync(agentRoot)?readdirSync(agentRoot).filter(x=>x.endsWith('.agent.md')).map(x=>x.slice(0,-9)):[];
 const f=join(root,project,'.evals','cases.json');
 let cases=[];
 if(!existsSync(f))missingManifests.push(project);
 else {cases=JSON.parse(readFileSync(f,'utf8'));if(!Array.isArray(cases))throw Error('Invalid eval cases: '+f);}
 const graphFile=join(root,project,'graph.mmd');
 if(existsSync(graphFile)){
  if(!parseAgentGraph)throw Error('Relay Agent Graph parser unavailable: '+parserPath);
  const roles=[...new Set(parseAgentGraph(readFileSync(graphFile,'utf8')).nodes.map(node=>node.agent))];
  const decisions=roles.map(role=>({role,caseCount:cases.filter(c=>c.role===role&&(c.type||'decision')==='decision').length}));
  dagCoverage[project]={agents:decisions,missingDecisionCases:decisions.filter(c=>c.caseCount===0).map(c=>c.role)};
 }
 const local=agents.map(role=>({role,caseCount:cases.filter(c=>c.role===role).length}));
 for(const entry of local){required++;if(entry.caseCount>0)covered++;else missing.push(`${project}/${entry.role}`);}
 console.log(`${project}: ${agents.length?'roles '+local.map(x=>x.role+'='+x.caseCount).join(', '):'NO_LOCAL_WORKER_ROLES (NOT_EVALUATED)'}; cases ${cases.length}`);
}
const missingDagDecisionCases=Object.entries(dagCoverage).flatMap(([project,value])=>value.missingDecisionCases.map(role=>project+'/'+role));
console.log(JSON.stringify({projects:projects.length,roles:required,rolesWithCases:covered,rolesWithoutCases:missing,projectsMissingEvalManifest:missingManifests,dagCoverage,missingDagDecisionCases},null,2));
if(missing.length||missingManifests.length||missingDagDecisionCases.length)process.exitCode=1;
