#!/usr/bin/env node
/** Native CLI local interaction acceptance. --live-ui explicitly opts into
 * production Neo.app read-only media preview compilation, never human review
 * or UI writes. The model endpoint and all credentials/data are synthetic.
 */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const binary=join(root,'target/debug/neo-rs');
const relay=process.env.NEO_BLACKBOX_RELAY_BINARY||join(homedir(),'.local/share/agents-relay/live/bin/agents-relay-rust');
const live=process.argv.slice(2).includes('--live-ui');
assert(process.argv.slice(2).every(x=>x==='--live-ui'),'Usage: [--live-ui]');
assert(existsSync(binary),'Build neo-rs first');
const base=mkdtempSync(join(tmpdir(),'neo-interaction-blackbox-'));
const cases=[];let server;
function run(exe,args,{env=process.env,cwd=root,timeout=30000}={}){
  return new Promise(done=>{
    let stdout='',stderr='';const p=spawn(exe,args,{env,cwd,stdio:['ignore','pipe','pipe']});
    const timer=setTimeout(()=>p.kill('SIGKILL'),timeout);
    p.stdout.on('data',b=>{stdout+=b;if(stdout.length>8e6)p.kill('SIGKILL')});p.stderr.on('data',b=>{stderr+=b;if(stderr.length>8e6)p.kill('SIGKILL')});
    p.once('error',()=>{clearTimeout(timer);done({code:-1,stdout:'',stderr:''})});
    p.once('close',code=>{clearTimeout(timer);done({code,stdout,stderr})});
  });
}
const cli=(args,opts)=>run(binary,args,opts);
const ok=r=>assert.equal(r.code,0,'Nonzero CLI exit');
const data=r=>JSON.parse(r.stdout);
const jsonFile=(path,v)=>writeFileSync(path,JSON.stringify(v),{mode:0o600});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function check(name,fn){try{await fn();cases.push({name,status:'PASS'})}catch(e){cases.push({name,status:'FAIL',reason:e.name==='SyntaxError'?'Invalid CLI JSON':String(e.message).slice(0,180)})}}
try{
  const home=join(base,'home'),work=join(base,'workspace');mkdirSync(home);mkdirSync(work);
  const env={HOME:home,PATH:process.env.PATH,NEO_HARNESS_ROOT:root,NEO_ESCALATION_ENGINE:'external',NEO_ESCALATION_MODEL:'fixture',NEO_ESCALATION_LOCK_DIR:join(home,'lock'),NEO_ESCALATION_LOCK_WAIT_SECONDS:'2',NEO_ESCALATION_BUDGET_SECONDS:'20',NEO_ESCALATION_MAX_TURNS:'4',NEO_ESCALATION_CHALLENGES_DIR:join(home,'challenges'),NEO_ESCALATION_CASES_DIR:join(home,'cases')};
  const marker=randomBytes(12).toString('hex'),markerPath=join(work,'marker.txt');writeFileSync(markerPath,marker+'\n',{mode:0o600});
  let mode='self-test',requests=0,toolReads=0,modelError=false;
  server=createServer(async(req,res)=>{
    try{
      assert.equal(req.method,'POST');assert.equal(req.url,'/v1/chat/completions');
      let raw='';for await(const b of req)raw+=b;
      const body=JSON.parse(raw);requests++;
      let message;
      if(body.tool_choice==='auto'){
        const command=mode==='self-test'?body.messages[1].content.split('`')[1]:'cat marker.txt';
        assert.ok(command?.startsWith('cat '));
        message={role:'assistant',content:null,tool_calls:[{id:'read-fixture',type:'function',function:{name:'shell',arguments:JSON.stringify({command})}}]};
      }else{
        const tool=body.messages.find(x=>x.role==='tool');assert.ok(tool);const output=JSON.parse(tool.content);assert.equal(output.ok,true);toolReads++;
        const observed=output.output.trim();
        if(mode==='self-test')assert.match(observed,/^[0-9a-f]{32}$/);else assert.equal(observed,marker);
        const result={status:'resolved',summary:'Verified local synthetic marker',reason:null,user_action:null,notification:null,evidence:mode==='invalid'?[]:[observed]};
        if(mode!=='self-test')result.experience={scenario_key:'fixture_marker',strategy_key:'read_fixture',category:'tooling',symptom:'Marker verification needed',steps:['Read fixture-only marker'],verification:'Observed marker in tool result'};
        message={role:'assistant',content:JSON.stringify(result)};
      }
      res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({choices:[{message}]}));
    }catch{modelError=true;res.writeHead(400).end();}
  });
  await new Promise((yes,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',yes)});env.NEO_ESCALATION_BASE_URL='http://127.0.0.1:'+server.address().port+'/v1';
  await check('Escalation self-test actual CLI, real nonce file read, local synthetic model endpoint',async()=>{
    const r=await cli(['escalation','test'],{env});ok(r);const x=data(r);assert.equal(x.status,'pass');assert.equal(x.checks.unknown_value_verified,true);assert.equal(x.checks.shell_tool_execution,true);assert.equal(x.checks.no_human_notification_requested,true);assert.equal(requests,2);assert.equal(toolReads,1);assert.equal(modelError,false);assert.ok(!existsSync(env.NEO_ESCALATION_CHALLENGES_DIR));
  });
  const handoff=join(base,'handoff.md'),policy=join(base,'policy.md');writeFileSync(handoff,'Verify only the marker.txt fixture in the caller-owned working directory. Do not mutate anything.');writeFileSync(policy,'Never notify a human during fixture acceptance.');
  const args=['escalation','--handoff-file',handoff,'--on-needs-user-file',policy,'--cwd',work,'--correlation-id','fixture/interaction/001'];
  function terminalRecords(){return readdirSync(env.NEO_ESCALATION_CHALLENGES_DIR).flatMap(n=>{const p=join(env.NEO_ESCALATION_CHALLENGES_DIR,n);return statSync(p).isDirectory()?readdirSync(p).filter(f=>f.endsWith('.finished.json')).map(f=>JSON.parse(readFileSync(join(p,f),'utf8'))):[]})}
  await check('Escalation handoff actual local shell, terminal Challenge and Experience',async()=>{
    mode='handoff';const before=requests;const r=await cli(args,{env});ok(r);assert.equal(data(r).status,'resolved');assert.equal(requests-before,2);assert.equal(modelError,false);
    const records=terminalRecords();assert.equal(records.length,1);assert.equal(records[0].outcome,'resolved');assert.equal(records[0].observed.calls,1);
    const files=readdirSync(env.NEO_ESCALATION_CASES_DIR).filter(n=>n.endsWith('.json'));assert.equal(files.length,1);const stored=JSON.parse(readFileSync(join(env.NEO_ESCALATION_CASES_DIR,files[0]),'utf8'));assert.equal(stored.outcome,'resolved');
    const list=await cli(['escalation','challenges'],{env});ok(list);assert.ok(data(list).length>=1);const history=await cli(['escalation','cases'],{env});ok(history);assert.ok(data(history).length>=1);
    assert.equal(readFileSync(markerPath,'utf8'),marker+'\n');
  });
  await check('Escalation invalid success is rejected and records one failed attempt',async()=>{
    mode='invalid';const before=toolReads;const r=await cli(args,{env});assert.notEqual(r.code,0);assert.equal(toolReads-before,1);const records=terminalRecords();assert.equal(records.length,2);assert.ok(records.some(x=>x.outcome==='failed'&&x.observed.calls===1));assert.equal(modelError,false);
  });
  const audio=join(base,'fixture.m4a');
  await check('Real macOS TTS artifact is verified by ffprobe and protected against overwrite',async()=>{
    const args=['project','tts','--text','这是本地命令行验收测试，不需要审核。','--output',audio,'--voice','Tingting','--rate','200'];
    const r=await cli(args);ok(r);assert.equal(data(r).engine,'macos-say');assert.equal(statSync(audio).mode&0o777,0o600);
    const probe=await run('ffprobe',['-v','error','-show_entries','format=duration:stream=codec_type','-of','json',audio]);ok(probe);const d=data(probe);assert.ok(Number(d.format.duration)>1);assert.ok(d.streams.some(s=>s.codec_type==='audio'));
    const old=readFileSync(audio);assert.notEqual((await cli(args)).code,0);assert.ok(old.equals(readFileSync(audio)));
  });
  if(live){
    await check('Live Neo.app readonly audio Preview reaches ready/complete',async()=>{
      const f=join(base,'preview.json');jsonFile(f,{path:audio,title:'Rust CLI readonly audio fixture',readonly:true});const r=await cli(['mcp','call','markcut.preview','--args-file',f]);ok(r);const receipt=data(r).structuredContent;assert.equal(receipt.review.readonly,true);assert.match(receipt.operationId,/^[0-9a-f-]+$/i);
      const deployment=join(homedir(),'Library/Application Support/NeoY/deployment.json');const config=existsSync(deployment)?JSON.parse(readFileSync(deployment,'utf8')):{};const port=config.mcpPort===9224?6767:(config.mcpPort??6767);
      const url='http://127.0.0.1:'+port+'/files/_neoy/markcut/operations/'+receipt.operationId+'.json';let finished;
      for(let i=0;i<50;i++){try{const response=await fetch(url,{signal:AbortSignal.timeout(2000)});if(response.ok){const result=await response.json();if(result.state==='failed')throw Error('Preview compilation failed');if(result.state==='ready'){finished=result;break}}}catch(e){if(e.message==='Preview compilation failed')throw e}await wait(250)}
      assert.ok(finished,'Preview ready receipt not observed');assert.equal(finished.stage,'complete');assert.ok(finished.result);
    });
    await check('Live Neo.app Computer Use app inventory and accessibility snapshot',async()=>{
      const listed=await cli(['computer-use','call','list_apps']);ok(listed);const apps=JSON.parse(data(listed).content[0].text).apps;assert.ok(Array.isArray(apps)&&apps.length>0);
      // Finder is a real native app; do not launch, activate or type into it.
      const f=join(base,'state.json');jsonFile(f,{app:'com.apple.finder'});const r=await cli(['computer-use','call','get_app_state','--args-file',f]);ok(r);const state=JSON.parse(data(r).content[0].text);assert.equal(state.app.bundleId,'com.apple.finder');assert.ok(state.state_id);assert.ok(state.snapshot.elements.length>0);
    });
  }
  // Independent outcome reviewer contract; NOT a managed Final Review or a real model evaluation.
  await check('Installed Rust Relay reviewer outcome contract PASS/CHANGE_REQUIRED/BLOCKED',async()=>{
    const project=join(base,'review-project');mkdirSync(project);ok(await run('git',['init','-q','-b','main'],{cwd:project}));
    for(const [verdict,code] of [['PASS',0],['CHANGE_REQUIRED',10],['BLOCKED',20]]){
      const provider=join(base,verdict+'.sh'),output=join(project,verdict+'.json');const result=JSON.stringify({verdict,summary:'Synthetic reviewer result',findings:[],evidence:['local fixture']});
      writeFileSync(provider,"#!/bin/sh\ncat >/dev/null\nprintf '%s\\n' '"+result+"'\n",{mode:0o700});
      const r=await run(relay,['review','run','--prompt','Evaluate disposable fixture only','--project-path',project,'--output',output],{env:{...process.env,AGENTS_RELAY_REVIEW_MODEL_BIN:provider},timeout:20000});assert.equal(r.code,code);assert.equal(data(r).verdict,verdict);assert.deepEqual(data(r),JSON.parse(readFileSync(output,'utf8')));
    }
  });
}finally{if(server){server.closeAllConnections();await new Promise(ok=>server.close(ok));}rmSync(base,{recursive:true,force:true});}
const passed=cases.filter(x=>x.status==='PASS').length;
console.log(JSON.stringify({scope:'native-cli-interaction-blackbox',passed,total:cases.length,cases,liveReadonlyUi:live,managedFinalReview:false,realModelInference:false,uiMutation:false},null,2));if(passed!==cases.length)process.exitCode=1;
