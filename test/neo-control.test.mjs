import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { executeControl, serviceRows } from '../.bin/neo-control.mjs';
import { loadWorkspaceConfig } from '../.bin/workspace-config.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
const root = resolve(import.meta.dirname, '..');
const cli = resolve(root, '.bin/neo.mjs');
const rows = [{name:'alpha', pid:12, pm2_env:{status:'online'}}, {name:'stopped',pid:0,pm2_env:{status:'stopped'}}];
const captured = () => { const calls=[]; const out=[]; return {calls,out, opts:{run:(bin,args)=> { calls.push([bin,args]); return bin==='pm2'&&args[0]==='jlist'?{code:0,stdout:JSON.stringify(rows)}:bin==='launchctl'?{code:1,stdout:''}:{code:0,stdout:'ok'}; },emit:x=>out.push(x)}}; };
test('service read-only list strips environment and sorts',()=>{const c=captured();executeControl(['service','list'],c.opts);const data=JSON.parse(c.out.join(''));assert.equal(data[0].name,'alpha');assert.equal(data[1].state,'stopped');assert.equal(data[0].pm2_env,undefined);assert.equal(c.calls[0][0],'pm2');assert.equal(c.calls[1][0],'launchctl');});
test('service status checks exact existing name',()=>{const c=captured();executeControl(['service','status','alpha'],c.opts);assert.equal(JSON.parse(c.out.join('')).pid,12);assert.throws(()=>executeControl(['service','status','unknown'],c.opts),/unknown managed service/);});
test('restart requires explicit apply, exact existing name, no shell',()=>{const c=captured();assert.throws(()=>executeControl(['service','restart','alpha'],c.opts),/usage/);assert.throws(()=>executeControl(['service','restart','not-in-inventory','--apply'],c.opts),/unknown managed/);executeControl(['service','restart','alpha','--apply'],c.opts);assert.deepEqual(c.calls.at(-1),['pm2',['restart','alpha']]);});
test('project, skill routes preserve resolver flags',()=>{const c=captured();executeControl(['project','resolve','neox'],c.opts);assert.deepEqual(c.calls.at(-1)[1],['--resolve','neox']);executeControl(['skill','list','--project','/tmp/project'],c.opts);assert.deepEqual(c.calls.at(-1)[1],['--project','/tmp/project']);});
test('workspace show returns the configured root and derived Neo root',()=>{
  const c=captured();
  executeControl(['workspace','show'],{...c.opts,workspace:{workspaceRoot:'/tmp/workspace',neoRoot:'/tmp/workspace/neo'}});
  assert.deepEqual(JSON.parse(c.out.join('')),{workspaceRoot:'/tmp/workspace',neoRoot:'/tmp/workspace/neo'});
  assert.throws(()=>executeControl(['workspace','set','/tmp'],c.opts),/usage/);
});
test('workspace config validates schema and falls back only when absent',()=>{
  const base=mkdtempSync(join(tmpdir(),'neo-workspace-'));
  try {
    const root=join(base,'chosen');mkdirSync(root);
    const file=join(base,'workspace.json');
    assert.deepEqual(loadWorkspaceConfig({configPath:join(base,'absent.json')}).workspaceRoot,resolve(process.env.HOME,'Workspace'));
    writeFileSync(file,JSON.stringify({schemaVersion:1,workspaceRoot:root}));
    assert.deepEqual(loadWorkspaceConfig({configPath:file}),{schemaVersion:1,workspaceRoot:root,neoRoot:join(root,'neo')});
    writeFileSync(file,JSON.stringify({schemaVersion:2,workspaceRoot:root}));
    assert.throws(()=>loadWorkspaceConfig({configPath:file}),/Invalid workspace configuration/);
  } finally { rmSync(base,{recursive:true,force:true}); }
});
test('skill discovery reads shared skills from the configured workspace Neo root',()=>{
  const base=mkdtempSync(join(tmpdir(),'neo-skill-root-'));
  try {
    const root=join(base,'workspace');mkdirSync(join(root,'neo','skills','selected-skill'),{recursive:true});
    writeFileSync(join(root,'neo','skills','selected-skill','SKILL.md'),'---\nname: selected-skill\ndescription: configured root test\n---\n');
    const config=join(base,'workspace.json');writeFileSync(config,JSON.stringify({schemaVersion:1,workspaceRoot:root}));
    const output=execFileSync(process.execPath,[cli,'skill','list'],{encoding:'utf8',timeout:15000,env:{...process.env,NEO_WORKSPACE_CONFIG:config}});
    const skills=JSON.parse(output);
    assert.ok(skills.some(skill=>skill.name==='selected-skill'&&skill.path===realpathSync(join(root,'neo','skills','selected-skill','SKILL.md'))),output);
  } finally { rmSync(base,{recursive:true,force:true}); }
});
test('live non-mutating CLI project route',()=>{const data=JSON.parse(execFileSync(process.execPath,[cli,'project','resolve','neo'],{encoding:'utf8',timeout:15000}));assert.equal(data.name,'neo');});

test('launchd NeoY is an explicitly managed service, not an arbitrary process',()=>{
const c=captured();const original=c.opts.run;c.opts.run=(cmd,args)=>{if(cmd==='launchctl'){c.calls.push([cmd,args]);return {code:0,stdout:'state = running\n pid = 42\n'};}return original(cmd,args);};
executeControl(['service','status','neoy/app'],c.opts);assert.equal(JSON.parse(c.out.join('')).manager,'launchd');
executeControl(['service','restart','neoy/app','--apply'],c.opts);assert.equal(c.calls.at(-1)[0],'launchctl');assert.deepEqual(c.calls.at(-1)[1][0],'kickstart');
});
test('health probe remains read-only and does not claim MCP tool readiness', () => {
  const c=captured(); const probes=[];
  c.opts.run=(bin,args)=>{probes.push([bin,args]);if(bin==='curl')return {code:0,stdout:'{"name":"NeoY","mcp_endpoint":"/mcp"}'};if(bin==='node')return {code:0,stdout:'v25.6.0'};return {code:0,stdout:'Python 3.9.6'};};
  assert.equal(executeControl(['status'],c.opts),0);
  assert.equal(JSON.parse(c.out.join('')).gateway_http,'reachable');assert.equal(JSON.parse(c.out.join('')).mcp_federation,'not_checked');
  assert.equal(probes.length,3);
  assert.deepEqual(probes.map(x=>x[0]),['curl','node','python3']);
});
test('missing gateway produces truthful degraded doctor and exit 2',()=>{
  const c=captured();c.opts.run=(bin,args)=>({code:bin==='curl'?7:0,stdout:bin==='node'?'v25.6.0':'Python 3.9.6',stderr:''});
  assert.equal(executeControl(['doctor'],c.opts),2);
  assert.match(JSON.parse(c.out.join('')).remediation.join(';'),/native gateway/);
});
test('PM2 unavailable still returns native launchd if available',()=>{
  const c=captured();c.opts.run=(cmd,args)=>cmd==='pm2'?{code:1,stdout:'',stderr:'offline'}:{code:0,stdout:'state = running\n pid = 40\n'};
  executeControl(['service','list'],c.opts);
  assert.equal(JSON.parse(c.out.join('')).length,1);
  assert.equal(JSON.parse(c.out.join(''))[0].name,'neoy/app');
});
test('service lifecycle cannot target unlisted or injected commands',()=>{
  const c=captured();
  assert.throws(()=>executeControl(['service','restart','-evil','--apply'],c.opts),/invalid service/);
  assert.throws(()=>executeControl(['service','stop','neoy/app','--apply'],{...c.opts,run:(bin,args)=>bin==='launchctl'?{code:0,stdout:'state = running\n pid = 40\n'}:c.opts.run(bin,args)}),/keepalive/);
  executeControl(['service','start','stopped','--apply'],c.opts);
  assert.deepEqual(c.calls.at(-1),['pm2',['start','stopped']]);
});
test('skill package delegates to legacy packager with original file arguments',()=>{
  const c=captured();executeControl(['skill','package','/tmp/source-skill','/tmp/output.zip'],c.opts);
  assert.match(c.calls.at(-1)[0],/package-web-chatgpt-skill$/);
  assert.deepEqual(c.calls.at(-1)[1],['/tmp/source-skill','/tmp/output.zip']);
});

test('project setup-agent delegates discovery and opens an encoded prompt in Chrome',()=>{
  const calls=[],output=[];
  const run=(bin,args)=>{
    calls.push([bin,args]);
    if(bin.endsWith('list-xchat-projects')) return {code:0,stdout:JSON.stringify({
      xchat_project:'neo/family-tutor',setup:{bootstrap:'/tmp/family tutor/setup/bootstrap.md'}
    }),stderr:''};
    if(bin==='/usr/bin/open') return {code:0,stdout:'',stderr:''};
    throw Error('unexpected executable');
  };
  assert.equal(executeControl(['project','setup-agent','family-tutor'],{run,emit:x=>output.push(x)}),0);
  assert.equal(calls[1][0],'/usr/bin/open');
  const url=new URL(calls[1][1][2]);
  assert.equal(url.hostname,'chatgpt.com');
  assert.match(url.searchParams.get('prompt'),/\/tmp\/family tutor\/setup\/bootstrap.md/);
  assert.equal(JSON.parse(output.join('')).promptSubmitted,false);
  assert.throws(()=>executeControl(['project','setup-agent','not-configured'],{
    run:(bin,args)=>({code:0,stdout:JSON.stringify({xchat_project:'neo/not-configured'}),stderr:''}),
  }),/no setup/);
});
