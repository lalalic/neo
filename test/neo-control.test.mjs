import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { executeControl, serviceRows } from '../.bin/neo-control.mjs';
const root = resolve(import.meta.dirname, '..');
const cli = resolve(root, '.bin/neo.mjs');
const rows = [{name:'alpha', pid:12, pm2_env:{status:'online'}}, {name:'stopped',pid:0,pm2_env:{status:'stopped'}}];
const captured = () => { const calls=[]; const out=[]; return {calls,out, opts:{run:(bin,args)=> { calls.push([bin,args]); return bin==='pm2'&&args[0]==='jlist'?{code:0,stdout:JSON.stringify(rows)}:bin==='launchctl'?{code:1,stdout:''}:{code:0,stdout:'ok'}; },emit:x=>out.push(x)}}; };
test('service read-only list strips environment and sorts',()=>{const c=captured();executeControl(['service','list'],c.opts);const data=JSON.parse(c.out.join(''));assert.equal(data[0].name,'alpha');assert.equal(data[1].state,'stopped');assert.equal(data[0].pm2_env,undefined);assert.equal(c.calls[0][0],'pm2');assert.equal(c.calls[1][0],'launchctl');});
test('service status checks exact existing name',()=>{const c=captured();executeControl(['service','status','alpha'],c.opts);assert.equal(JSON.parse(c.out.join('')).pid,12);assert.throws(()=>executeControl(['service','status','unknown'],c.opts),/unknown managed service/);});
test('restart requires explicit apply, exact existing name, no shell',()=>{const c=captured();assert.throws(()=>executeControl(['service','restart','alpha'],c.opts),/usage/);assert.throws(()=>executeControl(['service','restart','not-in-inventory','--apply'],c.opts),/unknown managed/);executeControl(['service','restart','alpha','--apply'],c.opts);assert.deepEqual(c.calls.at(-1),['pm2',['restart','alpha']]);});
test('project, skill routes preserve resolver flags',()=>{const c=captured();executeControl(['project','resolve','neox'],c.opts);assert.deepEqual(c.calls.at(-1)[1],['--resolve','neox']);executeControl(['skill','list','--project','/tmp/project'],c.opts);assert.deepEqual(c.calls.at(-1)[1],['--project','/tmp/project']);});
test('live non-mutating CLI project route',()=>{const data=JSON.parse(execFileSync(process.execPath,[cli,'project','resolve','neo'],{encoding:'utf8',timeout:15000}));assert.equal(data.name,'neo');});

test('launchd NeoY is an explicitly managed service, not an arbitrary process',()=>{
const c=captured();const original=c.opts.run;c.opts.run=(cmd,args)=>{if(cmd==='launchctl'){c.calls.push([cmd,args]);return {code:0,stdout:'state = running\n pid = 42\n'};}return original(cmd,args);};
executeControl(['service','status','neoy'],c.opts);assert.equal(JSON.parse(c.out.join('')).manager,'launchd');
executeControl(['service','restart','neoy','--apply'],c.opts);assert.equal(c.calls.at(-1)[0],'launchctl');assert.deepEqual(c.calls.at(-1)[1][0],'kickstart');
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
  assert.equal(JSON.parse(c.out.join(''))[0].name,'neoy');
});
test('service lifecycle cannot target unlisted or injected commands',()=>{
  const c=captured();
  assert.throws(()=>executeControl(['service','restart','-evil','--apply'],c.opts),/invalid service/);
  assert.throws(()=>executeControl(['service','stop','neoy','--apply'],{...c.opts,run:(bin,args)=>bin==='launchctl'?{code:0,stdout:'state = running\n pid = 40\n'}:c.opts.run(bin,args)}),/keepalive/);
  executeControl(['service','start','stopped','--apply'],c.opts);
  assert.deepEqual(c.calls.at(-1),['pm2',['start','stopped']]);
});
test('skill package delegates to legacy packager with original file arguments',()=>{
  const c=captured();executeControl(['skill','package','/tmp/source-skill','/tmp/output.zip'],c.opts);
  assert.match(c.calls.at(-1)[0],/package-web-chatgpt-skill$/);
  assert.deepEqual(c.calls.at(-1)[1],['/tmp/source-skill','/tmp/output.zip']);
});
