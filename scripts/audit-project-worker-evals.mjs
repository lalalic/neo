#!/usr/bin/env node
/** Detect omitted project-local worker roles. Missing cases never count as PASS. */
import {readdirSync,readFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const projects=readdirSync(root,{withFileTypes:true}).filter(x=>x.isDirectory()&&existsSync(join(root,x.name,'AGENTS.md'))).map(x=>x.name).sort();
let required=0,covered=0,missing=[],missingManifests=[];
for(const project of projects){
 const agentRoot=join(root,project,'agents');
 const agents=existsSync(agentRoot)?readdirSync(agentRoot).filter(x=>x.endsWith('.agent.md')).map(x=>x.slice(0,-9)):[];
 const f=join(root,project,'.evals','cases.json');
 let cases=[];
 if(!existsSync(f))missingManifests.push(project);
 else {cases=JSON.parse(readFileSync(f,'utf8'));if(!Array.isArray(cases))throw Error('Invalid eval cases: '+f);}
 const local=agents.map(role=>({role,caseCount:cases.filter(c=>c.role===role).length}));
 for(const entry of local){required++;if(entry.caseCount>0)covered++;else missing.push(`${project}/${entry.role}`);}
 console.log(`${project}: ${agents.length?'roles '+local.map(x=>x.role+'='+x.caseCount).join(', '):'NO_LOCAL_WORKER_ROLES (NOT_EVALUATED)'}; cases ${cases.length}`);
}
console.log(JSON.stringify({projects:projects.length,roles:required,rolesWithCases:covered,rolesWithoutCases:missing,projectsMissingEvalManifest:missingManifests},null,2));
if(missing.length||missingManifests.length)process.exitCode=1;
