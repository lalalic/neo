#!/usr/bin/env node
/** Release CLI fault injection: real subprocesses; disposable HOME, loopback
 * HTTP fixture. Optional cached GGUF tests actual owned llama-server teardown.
 * No model download, paid provider, production Job or launcher changes. */
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
import {existsSync,mkdirSync,mkdtempSync,writeFileSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),binary=join(root,'target/release/neo-rs');
const model=process.env.NEO_BLACKBOX_LOCAL_GGUF;
assert(existsSync(binary),'Build native Release first');
if(model)assert(model.startsWith('/')&&model.endsWith('.gguf')&&statSync(model).isFile(),'Use an existing local GGUF file only');
const base=mkdtempSync(join(tmpdir(),'neo-reliability-blackbox-')),home=join(base,'home');mkdirSync(home);
const cases=[];const wait=ms=>new Promise(r=>setTimeout(r,ms));
let server,ownedCaller,ownedServer,ownedGuardian;
const env={HOME:home,PATH:process.env.PATH,NEO_HARNESS_ROOT:root,TMPDIR:base};
function launch(args,extra={},timeout=20000){const child=spawn(binary,args,{cwd:base,env:{...env,...extra},stdio:['ignore','pipe','pipe']});let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);const done=new Promise((resolve,reject)=>{const timer=setTimeout(()=>child.kill('SIGKILL'),timeout);child.once('error',e=>{clearTimeout(timer);reject(e)});child.once('close',(code,signal)=>{clearTimeout(timer);resolve({code,signal,out,err})})});return {child,done};}
const cli=(args,extra,timeout)=>launch(args,extra,timeout).done;
async function check(name,fn){try{await fn();cases.push({name,status:'PASS'})}catch(e){cases.push({name,status:'FAIL',reason:String(e.message).slice(0,200)})}}
function processRows(){const r=spawnSync('/bin/ps',['-axo','pid=,ppid=,pgid=,command='],{encoding:'utf8'});assert.equal(r.status,0);return r.stdout.trim().split('\n').map(x=>{const m=x.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/);return m?{pid:+m[1],ppid:+m[2],pgid:+m[3],command:m[4]}:null}).filter(Boolean)}
function stillOwned(row){return row&&processRows().some(x=>x.pid===row.pid&&x.command===row.command)}
async function until(test,ms){const end=Date.now()+ms;while(Date.now()<end){const result=test();if(result)return result;await wait(100)}return null}
try{
 const deployment=join(home,'Library/Application Support/NeoY');mkdirSync(deployment,{recursive:true});
 let mode='ok',calls=0,mutations=0;
 server=createServer(async(req,res)=>{
  let s='';for await(const b of req)s+=b;
  const request=JSON.parse(s);calls++;
  if(request.method==='tools/call')mutations++;
  if(mode==='drop'&&request.method==='tools/call'){req.socket.destroy();return;}
  if(mode==='http-error'){res.writeHead(503).end('unavailable');return;}
  if(mode==='bad-json'){res.writeHead(200).end('not JSON');return;}
  if(mode==='wrong-id'){res.writeHead(200).end(JSON.stringify({jsonrpc:'2.0',id:99,result:{tools:[]}}));return;}
  if(mode==='rpc-error'){res.writeHead(200).end(JSON.stringify({jsonrpc:'2.0',id:1,error:{code:-32001,message:'fixture rejected'}}));return;}
  if(mode==='redirect'){res.writeHead(307,{location:'/unexpected'}).end();return;}
  const result=request.method==='tools/list'?{tools:[{name:'askquestions'}]}:{isError:false,content:[{type:'text',text:'fixture result'}]};
  res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({jsonrpc:'2.0',id:1,result}));
 });
 await new Promise((ok,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',ok)});
 const port=server.address().port;writeFileSync(join(deployment,'deployment.json'),JSON.stringify({mcpPort:port}));
 const args=join(base,'args.json');writeFileSync(args,JSON.stringify({title:'Fixture',questions:['Synthetic?']}));
 const inventory=['mcp','tools'];const call=['mcp','call','askquestions','--args-file',args];
 await check('MCP HTTP 503 fails and later invocation recovers',async()=>{mode='http-error';let r=await cli(inventory);assert.notEqual(r.code,0);assert.match(r.err,/HTTP 503/);mode='ok';assert.equal((await cli(inventory)).code,0)});
 await check('MCP malformed JSON, wrong ID and RPC error fail closed',async()=>{for(const m of ['bad-json','wrong-id','rpc-error']){mode=m;const r=await cli(inventory);assert.notEqual(r.code,0);assert.equal(r.out,'');}mode='ok';assert.equal((await cli(inventory)).code,0)});
 await check('MCP redirect rejected with no second HTTP request',async()=>{mode='redirect';const before=calls;assert.notEqual((await cli(inventory)).code,0);assert.equal(calls-before,1);mode='ok';});
 await check('MCP dropped mutating response is not automatically replayed',async()=>{mode='drop';const before=mutations;const r=await cli(call);assert.notEqual(r.code,0);assert.equal(mutations-before,1);mode='ok';const success=await cli(call);assert.equal(success.code,0);assert.equal(mutations-before,2);});
 await check('MCP unavailable listener returns failure; restart restores same CLI',async()=>{server.closeAllConnections();await new Promise(ok=>server.close(ok));const r=await cli(inventory);assert.notEqual(r.code,0);await new Promise((ok,no)=>{server.once('error',no);server.listen(port,'127.0.0.1',ok)});assert.equal((await cli(inventory)).code,0)});
 if(model){
  const lock=join(base,'lock');const actual={NEO_ESCALATION_ENGINE:'llama',NEO_ESCALATION_MODEL:model,NEO_ESCALATION_SERVER_COMMAND:process.env.NEO_BLACKBOX_LLAMA_SERVER||'/opt/homebrew/bin/llama-server',NEO_ESCALATION_STARTUP_MS:'90000',NEO_ESCALATION_BUDGET_SECONDS:'120',NEO_ESCALATION_LOCK_DIR:lock,NEO_ESCALATION_LOCK_WAIT_SECONDS:'5'};
  await check('Real model process slot contention and caller-only SIGKILL cleanup',async()=>{
   const first=launch(['escalation','test'],actual,150000);ownedCaller=first.child;
   const registered=await until(()=>{const rows=processRows();const children=rows.filter(x=>x.ppid===first.child.pid);const model=children.find(x=>x.command.includes('llama-server')&&x.command.includes('neo-escalation'));const guard=children.find(x=>x.command.includes('__escalation-lock-guardian'));return model&&guard?{model,guard}:null},20000);
   assert(registered,'Actual owned model and guardian processes not observed');ownedServer=registered.model;ownedGuardian=registered.guard;assert.equal(ownedServer.pid,ownedServer.pgid);
   const second=await cli(['escalation','test'],{...actual,NEO_ESCALATION_LOCK_WAIT_SECONDS:'1'},10000);assert.notEqual(second.code,0);assert.match(second.err,/lock|slot|busy|timeout/i);assert(stillOwned(ownedServer),'First model must remain owned during competing request');
   first.child.kill('SIGKILL');const result=await first.done;assert.equal(result.signal,'SIGKILL');
   assert(await until(()=>!stillOwned(ownedServer)&&!stillOwned(ownedGuardian),18000),'Guardian failed to release owned model after caller SIGKILL');
   ownedCaller=null;ownedServer=null;ownedGuardian=null;
  });
  await check('Real inference recovers after abrupt exit and reuses exclusive slot',async()=>{const r=await cli(['escalation','test'],actual,150000);assert.equal(r.code,0,r.err.slice(-200));const result=JSON.parse(r.out);assert.equal(result.status,'pass');assert.equal(result.checks.unknown_value_verified,true);assert.equal(result.checks.model_process_released,true)});
 }
}finally{
 if(ownedCaller&&ownedCaller.exitCode===null&&ownedCaller.signalCode===null)ownedCaller.kill('SIGKILL');
 if(ownedServer&&stillOwned(ownedServer)){await until(()=>!stillOwned(ownedServer),14000);if(stillOwned(ownedServer))try{process.kill(-ownedServer.pgid,'SIGKILL')}catch{}}
 if(ownedGuardian&&stillOwned(ownedGuardian))try{process.kill(ownedGuardian.pid,'SIGTERM')}catch{}
 if(server?.listening){server.closeAllConnections();await new Promise(ok=>server.close(ok));}
 rmSync(base,{recursive:true,force:true});
}
const passed=cases.filter(x=>x.status==='PASS').length;console.log(JSON.stringify({scope:'release-cli-reliability',passed,total:cases.length,cases,realModel:!!model,productionTouched:false},null,2));if(passed!==cases.length)process.exitCode=1;
