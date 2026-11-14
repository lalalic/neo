import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {mkdtempSync,writeFileSync,rmSync,appendFileSync,readFileSync,realpathSync} from 'node:fs';
import {spawn,execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {federationConfiguration,operationIdFromResult,previewCall as previewCallRaw,relayJobTitle,managedReviewTitle,relayControl,relayInteractiveArgs,notifyReview,reviewNotifyURL,singleMediaPreviewPath,questionsPreviewPath,buildNeoReviewRequest} from '../markcut.mjs';
const previewCall=(message,forward,options={})=>previewCallRaw(message,forward,{getJobTitle:async()=> 'Sample Job',...options});
const id=randomUUID();
const relay={jobId:'j1',taskId:'producer',executionId:'exec-1'};
const eventTemplate={type:'task.interactive_decision',source:'job/j1/task/producer/execution/exec-1',
 data:{interactive:{...relay}}};
const receipt={...relay,eventTemplate};
const message={jsonrpc:'2.0',id:44,method:'tools/call',params:{name:'markcut.preview',arguments:{path:'/tmp/video.md',review:{relay}}}};
test('askquestions generates Markdown scene titles without losing multiline UTF-8 formatting',()=>{
 const dir=mkdtempSync(join(tmpdir(),'neo-qtest-'));
 try{
  const markdown='**中文问题？**\n- one\n- two \"quoted\"';
  const path=questionsPreviewPath([markdown,'Plain text']);
  const body=readFileSync(path,'utf8');
  assert.match(body,/## Q1 title:"md64:/);
  assert.match(body,/## Q2 title:"md64:/);
  const encoded=body.match(/## Q1 title:"md64:([^"]+)"/)[1];
  assert.equal(Buffer.from(encoded,'base64').toString('utf8'),markdown);
  assert.match(body,/- component duration:1 jsx:"<div\/>"/);
  assert.throws(()=>questionsPreviewPath([]),/1-40/);
  rmSync(path.slice(0,path.lastIndexOf('/')),{recursive:true,force:true});
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('managed title resolves real Relay metadata and honors explicit caller titles',async()=>{
 const fetched=await relayJobTitle('626',{exec:async(_bin,args)=>{
   assert.deepEqual(args,['job','show','--id','626']);
   return {stdout:JSON.stringify({id:'626',title:'Growth 第一条爆款复刻 · 六阶段审核'})};
 }});
 assert.equal(managedReviewTitle('626',fetched),'626:Growth 第一条爆款复刻 · 六阶段审核');
 await assert.rejects(relayJobTitle('627',{exec:async()=>({stdout:JSON.stringify({id:'626',title:'Wrong job'})})}),/title unavailable/);
 const explicit={...message,params:{...message.params,arguments:{...message.params.arguments,title:'Review for editor'}}};
 await previewCall(explicit,async forwarded=>{
   assert.equal(forwarded.params.arguments.title,'Review for editor');
   return {structuredContent:{operationId:randomUUID()}};
 },{getJobTitle:()=>{throw Error('Explicit title must bypass lookup')},
    control:async command=>command==='review.interactive.begin'?receipt:{waiting:true},record:()=>{},notifyWatcher:()=>{}});
});
test('review inbox metadata never uses private ghost filenames as user-visible titles',()=>{
 const operation={state:'ready',requestedPath:'/private/.ghost.growth-review-growth-researcher.md',
  result:{id:'preview',contentHash:'a'.repeat(64),revisionId:'r1',review:{delivery:'text'}}};
 assert.equal(buildNeoReviewRequest(randomUUID(),operation,{jobId:'626'}).title,'Job #626');
 assert.equal(buildNeoReviewRequest(randomUUID(),operation).title,'Preview');
 const generated={...operation,result:{...operation.result,title:'626:Growth 第一条爆款复刻 · 六阶段审核'}};
 const generatedRequest=buildNeoReviewRequest(randomUUID(),generated,{jobId:'626'});
 assert.equal(generatedRequest.title,'626:Growth 第一条爆款复刻 · 六阶段审核');
 assert.equal(generatedRequest.customTitle,undefined);
 assert.equal(generatedRequest.groupTitle,generatedRequest.title);
 const withTitle={...operation,result:{...operation.result,title:'Chosen title'}};
 assert.equal(buildNeoReviewRequest(randomUUID(),withTitle,{jobId:'627'}).title,'Chosen title');
 assert.equal(buildNeoReviewRequest(randomUUID(),withTitle,{jobId:'627'}).customTitle,true);
});
test('stdio federation config points to wrapper, not original provider',()=>{
 const config=federationConfiguration({node:'/opt/homebrew/bin/node',wrapper:'/tmp/neox/wrapper.mjs',upstream:'/tmp/markcut/launch.sh'});
 assert.equal(config.name,'markcut');const url=new URL(config.url);
 assert.equal(url.protocol,'stdio:');assert.equal(url.pathname,'/opt/homebrew/bin/node');
 assert.deepEqual(url.searchParams.getAll('arg'),['/tmp/neox/wrapper.mjs','/tmp/markcut/launch.sh']);
});
test('Preview wrapper requests Relay Invocation, preserves MCP UI output, then waits and watches',async()=>{
 const calls=[],passed=[];
 const output={content:[{type:'text',text:'compile started'}],structuredContent:{operationId:randomUUID(),state:'compiling'},
  _meta:{ui:{resourceUri:'ui://markcut/preview.html'}}};
 const control=async(command,args)=>{calls.push(command);assert.equal(args.jobId,'j1');return command==='review.interactive.begin'?receipt:{waiting:true}};
 const got=await previewCall(message,async req=>{passed.push(req);return output;},
  {control,record:(operation,bind)=>{assert.equal(operation,output.structuredContent.operationId);assert.deepEqual(bind,relay);calls.push('persist');},
   notifyWatcher:operation=>{assert.equal(operation,output.structuredContent.operationId);calls.push('watch');}});
 assert.equal(got,output);
 assert.deepEqual(calls,['review.interactive.begin','persist','review.interactive.wait','watch']);
 assert.deepEqual(passed[0].params.arguments.review.eventTemplate.data.interactive,relay);
 assert.equal(passed[0].params.arguments.review.relay,undefined);
 assert.equal(passed[0].params.arguments.review.eventTemplate.responseKey,'interactive');
 assert.equal(passed[0].params.arguments.path,'/tmp/video.md');
 assert.equal(passed[0].params.arguments.title,'j1:Sample Job');
});
test('Neo Wrapper, not Markcut, rejects unauthorized Relay event type or identity',async()=>{
 for(const bad of [
  {...eventTemplate,type:'task.completed'},
  {...eventTemplate,source:'job/j1/task/other/execution/exec-1'},
  {...eventTemplate,data:{interactive:{...relay,decision:'approved'}}},
 ]){
  let forwarded=false;
  await assert.rejects(previewCall(message,async()=>{forwarded=true;return {}},
   {control:async command=>command==='review.interactive.begin'?{...receipt,eventTemplate:bad}:{waiting:true},
    record:()=>{},notifyWatcher:()=>{}}),/Invalid Relay review event template/);
  assert.equal(forwarded,false);
 }
});

test('Managed review binds the execution without Git or extra invocation identity',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'neo-preview-no-git-'));
 try{
  const path=join(dir,'in-progress.md');writeFileSync(path,'# Draft');
  const git=(...args)=>execFileSync('git',args,{cwd:dir,encoding:'utf8'}).trim();
  git('init','-q');git('add','--',path);git('-c','user.name=Test','-c','user.email=t@x','commit','-qm','initial');
  const before=git('rev-parse','HEAD');appendFileSync(path,'\nmore content');const status=git('status','--porcelain');
  const controls=[];
  await previewCall({...message,params:{...message.params,arguments:{path,review:{relay}}}},
   async forwarded=>{assert.deepEqual(forwarded.params.arguments.review.eventTemplate,{...eventTemplate,responseKey:'interactive'});
     assert.equal(forwarded.params.arguments.review.commitSha,undefined);return {structuredContent:{operationId:randomUUID()}};},
   {control:async cmd=>{controls.push(cmd);return cmd==='review.interactive.begin'?receipt:{waiting:true}},record:()=>{},notifyWatcher:()=>{}});
  assert.deepEqual(controls,['review.interactive.begin','review.interactive.wait']);
  assert.equal(git('rev-parse','HEAD'),before);assert.equal(git('status','--porcelain'),status);
 }finally{rmSync(dir,{recursive:true,force:true})}
});

test('managed review allows single-media ghost preview without a Git commit',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'neo-managed-media-'));
 try {
  const path=join(dir,'render.mp4');
  writeFileSync(path,'fake video');
  const request={...message,params:{...message.params,arguments:{path,review:{relay}}}};
  await previewCall(request,async forwarded=>{
   assert.equal(forwarded.params.arguments.path,join(realpathSync(dir),'.ghost.markcut.md'));
   assert.equal(forwarded.params.arguments.title,'j1:Sample Job');
   assert.equal(forwarded.params.arguments.review.commitSha,undefined);
   return {structuredContent:{operationId:randomUUID()}};
  },{control:async cmd=>cmd==='review.interactive.begin'?receipt:{waiting:true},
     record:()=>{},notifyWatcher:()=>{},
     resolveMedia:value=>singleMediaPreviewPath(value,{probe:()=>JSON.stringify({streams:[{width:1280,height:720}],format:{duration:12}})})});
  assert.equal(readFileSync(join(dir,'.ghost.markcut.md'),'utf8').includes('render.mp4'),true);
 }finally{rmSync(dir,{recursive:true,force:true})}
});
test('single image, video and audio use one stable ghost Markdown filename with exact source and duration',()=>{
 const directory=mkdtempSync(join(tmpdir(),'neo-ghost-preview-'));
 try{
  for(const [name,kind,duration,width,height] of [
   ['image with space.png','image',5,320,240],
   ['final output.mp4','video',2.321,1920,1080],
   ['narration.mp3','audio',3.125,1280,720],
  ]){
   const source=join(directory,name);writeFileSync(source,'fixture');
   let probes=0;
   const ghost=singleMediaPreviewPath(source,{probe:(_binary,args)=>{probes++;assert.equal(args.at(-1),realpathSync(source));return JSON.stringify({streams:kind==='audio'?[]:[{width,height}],format:{duration}})}});
   assert.equal(ghost,join(realpathSync(directory),'.ghost.markcut.md'));
   const body=readFileSync(ghost,'utf8');
   assert.match(body,new RegExp('^- '+kind+' src:', 'm'));
   assert.ok(body.includes('src:'+JSON.stringify(realpathSync(source))));
   assert.ok(body.includes('duration:'+duration.toFixed(3)));
   assert.ok(body.includes(kind==='video'?'width:1280 height:720':('width:'+width+' height:'+height)));
   assert.equal(probes,1);
   assert.equal(singleMediaPreviewPath('/some/video.md'),'/some/video.md');
  }
 }finally{rmSync(directory,{recursive:true,force:true});}
});
test('single media readonly forwards ghost Markdown without Relay, watcher or phone notification',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'neo-ghost-readonly-'));
 try{
  const source=join(directory,'my image.jpg');writeFileSync(source,'fixture');
  const request={...message,params:{...message.params,arguments:{path:source,readonly:true}}};
  const result={structuredContent:{operationId:randomUUID()}};
  const got=await previewCall(request,async forwarded=>{
   assert.equal(forwarded.params.arguments.path,join(realpathSync(directory),'.ghost.markcut.md'));
   assert.equal(forwarded.params.arguments.readonly,true);
   assert.equal(forwarded.params.arguments.title,'my image.jpg');
   assert.equal(request.params.arguments.path,source);
   return result;
  },{control:()=>{throw Error('No Relay')},
    record:()=>{throw Error('No delivery intent')},
    notifyWatcher:()=>{throw Error('No notification')},
   resolveMedia:path=>singleMediaPreviewPath(path,{probe:()=>JSON.stringify({streams:[{width:320,height:240}],format:{duration:1}})})});
  assert.equal(got,result);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
test('single-media interactive preview keeps existing standalone delivery and managed media uses ghost Markdown',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'neo-ghost-interactive-'));
 try{
  const source=join(directory,'shot.png');writeFileSync(source,'fixture');
  const calls=[];
  const request={...message,params:{...message.params,arguments:{path:source}}};
  await previewCall(request,async forwarded=>{
   assert.equal(forwarded.params.arguments.path,join(realpathSync(directory),'.ghost.markcut.md'));
   assert.equal(forwarded.params.arguments.review,undefined);
   assert.equal(forwarded.params.arguments.title,'shot.png');
   return {structuredContent:{operationId:randomUUID()}};
  },{control:()=>{throw Error('No Relay')},
    record:()=>{calls.push('record')},notifyWatcher:()=>{calls.push('notify')},
    resolveMedia:path=>singleMediaPreviewPath(path,{probe:()=>JSON.stringify({streams:[{width:320,height:240}],format:{duration:1}})})});
  assert.deepEqual(calls,['record','notify']);
  const managed={...request,params:{...request.params,arguments:{...request.params.arguments,review:{relay}}}};
  await previewCall(managed,async forwarded=>{
   assert.equal(forwarded.params.arguments.path,join(realpathSync(directory),'.ghost.markcut.md'));
   assert.equal(forwarded.params.arguments.review.commitSha,undefined);
   return {structuredContent:{operationId:randomUUID()}};
  },{control:async cmd=>cmd==='review.interactive.begin'?receipt:{waiting:true},
     record:()=>{},notifyWatcher:()=>{},
     resolveMedia:path=>singleMediaPreviewPath(path,{probe:()=>JSON.stringify({streams:[{width:320,height:240}],format:{duration:1}})})});
 }finally{rmSync(directory,{recursive:true,force:true});}
});

test('readonly preview bypasses Git, Relay, watcher and Inbox side effects',async()=>{
 const source={...message,params:{...message.params,arguments:{path:'/tmp/readonly.md',readonly:true}}};
 const expected={structuredContent:{operationId:randomUUID(),review:{delivery:'text',readonly:true}}};
 const got=await previewCall(source,async forwarded=>{
  assert.deepEqual(forwarded,source);
  return expected;
 },{control:()=>{throw Error('Readonly must not call Relay');},
   record:()=>{throw Error('Readonly must not persist a delivery intent');},
   notifyWatcher:()=>{throw Error('Readonly must not start notification watcher');}});
 assert.deepEqual(got,expected);
 for(const invalid of [
  {...source,params:{...source.params,arguments:{...source.params.arguments,review:{relay}}}},
  {...source,params:{...source.params,arguments:{...source.params.arguments,review:{delivery:'text'}}}}
 ]){
  await assert.rejects(previewCall(invalid,async()=>{throw Error('Must not compile');}),/cannot request Relay or review delivery/);
 }
});
test('legacy top-level relay is rejected rather than silently ignored',async()=>{
 const invalid={...message,params:{...message.params,arguments:{path:'/tmp/video.md',relay}}};
 await assert.rejects(previewCall(invalid,async()=>{throw Error('must not call');}),/review.relay/);
});
test('Preview wrapper keeps standalone Markcut independent of Relay',async()=>{
 const got=await previewCall({...message,params:{...message.params,arguments:{path:'/tmp/video.md'}}},
   async forwarded=>{assert.equal(forwarded.params.arguments.review,undefined);return {structuredContent:{operationId:randomUUID()}};},
   {control:()=>{throw Error('Relay must not be invoked');},record:()=>{},notifyWatcher:()=>{}});
 assert.ok(operationIdFromResult(got));
});
test('Provider failure aborts existing Relay Invocation and does not notify phone',async()=>{
 const calls=[];
 const got=await previewCall(message,async()=>({isError:true,content:[{type:'text',text:'invalid file'}]}),
  {control:async c=>{calls.push(c);return c==='review.interactive.begin'?receipt:{};},
   record:()=>{throw Error('no delivery for bad source');},notifyWatcher:()=>{throw Error('no notification');}});
 assert.equal(got.isError,true);
 assert.deepEqual(calls,['review.interactive.begin','review.interactive.abort']);
});
test('Upstream stdio preview UI descriptor and resources/read are forwarded intact',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'neo-proxy-'));
 const server=join(dir,'backend.mjs');
 writeFileSync(server,`import readline from 'node:readline';\nfor await(const line of readline.createInterface({input:process.stdin})) {\nlet m=JSON.parse(line);\nlet result=m.method==='initialize'?{protocolVersion:'2025-06-18',capabilities:{tools:{},resources:{}},serverInfo:{name:'mock',version:'1'}}:m.method==='tools/list'?{tools:[{name:'markcut.preview',description:'original',inputSchema:{type:'object',properties:{}},_meta:{ui:{resourceUri:'ui://markcut/player.html'}}}]}:m.method==='resources/read'?{contents:[{uri:'ui://markcut/player.html',mimeType:'text/html;profile=mcp-app',text:'<h1>Player</h1>'}]}:{isError:true,content:[{type:'text',text:'fixture-error'}]};\nprocess.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');\n}`);
 const script=fileURLToPath(new URL('../markcut.mjs',import.meta.url));
 const child=spawn(process.execPath,[script,process.execPath,server],{stdio:['pipe','pipe','pipe'],env:{...process.env,NEOY_PREVIEW_DELIVERY_DIR:dir}});
 const input=[{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'test',version:'1'}}},
 {jsonrpc:'2.0',id:2,method:'tools/list',params:{}},
 {jsonrpc:'2.0',id:3,method:'resources/read',params:{uri:'ui://markcut/player.html'}},
 {jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'markcut.preview',arguments:{path:'/missing.md'}}},
 {jsonrpc:'2.0',id:5,method:'tools/call',params:{name:'review.preview.acquire',arguments:{deviceId:randomUUID()}}}];
 try{
  const result=await new Promise((resolve,reject)=>{
   let stdout='',stderr='';const found=[];
   const timer=setTimeout(()=>reject(Error('Proxy timed out '+stderr+' '+stdout)),9000);
   child.stdout.on('data',b=>{stdout+=b.toString();let index;
     while((index=stdout.indexOf('\n'))>=0){const line=stdout.slice(0,index);stdout=stdout.slice(index+1);
       if(line){found.push(JSON.parse(line));if(found.length===5){clearTimeout(timer);resolve(found);}}
     }});
   child.stderr.on('data',b=>{stderr+=b.toString()});
   child.on('error',reject);
   child.stdin.write(input.map(v=>JSON.stringify(v)).join('\n')+'\n');
  });
  const get=i=>result.find(r=>r.id===i);
  assert.equal(get(1).result.serverInfo.name,'mock');
  assert.match(get(2).result.tools[0].description,/Neo-hosted/);
  assert.deepEqual(get(2).result.tools.map(tool=>tool.name),['markcut.preview','review.preview','askquestions','review.preview.acquire']);
  assert.equal(get(2).result.tools[0]._meta.ui.resourceUri,'ui://markcut/player.html');
  assert.equal(get(2).result.tools[1]._meta.ui.resourceUri,'ui://markcut/player.html');
  assert.deepEqual(get(2).result.tools[1].inputSchema.required,['path']);
  assert.match(get(3).result.contents[0].text,/Player/);
  assert.equal(get(4).result.isError,true);
  assert.deepEqual(get(5).result.structuredContent.requests,[]);
  assert.deepEqual(get(5).result.structuredContent.acked,[]);
 }finally{child.kill();rmSync(dir,{recursive:true,force:true})}
});

test('duplicate preview call for one Relay execution is rejected before a second compile',async()=>{
 const calls=[];
 await assert.rejects(previewCall(message,async()=>{throw Error('must not compile twice')},{
   control:async command=>{calls.push(command);return {...receipt,reused:true};},
   record:()=>{throw Error('must not record twice');},notifyWatcher:()=>{throw Error('must not notify twice');}
 }),/already requested/);
 assert.deepEqual(calls,['review.interactive.begin']);
});

test('Neo wrapper invokes Relay CLI with exact interactive identities; no direct HTTP',async()=>{
 const observed=[];
 const result=await relayControl('review.interactive.begin',
   {jobId:'556',taskId:'producer',executionId:'exec-123'},
   {exec:async(binary,args,options)=>{
     observed.push({binary,args,options});
     return {stdout:JSON.stringify({executionId:'exec-123'})};
   }});
 assert.equal(result.executionId,'exec-123');
 assert.match(observed[0].binary,/agents-relay$/);
 assert.deepEqual(observed[0].args,['review','interactive','begin','--id','556',
  '--task-id','producer','--execution-id','exec-123']);
 assert.equal(observed[0].options.timeout,15000);
 assert.deepEqual(relayInteractiveArgs('review.interactive.wait',{
  jobId:'556',taskId:'producer',executionId:'exec-123'}).slice(-4),
  ['--task-id','producer','--execution-id','exec-123']);
 assert.throws(()=>relayInteractiveArgs('job.delete',{jobId:'556'}),/Unsupported/);
});

test('Neo integration calls private localhost REST notify without MCP or CLI',async()=>{
 const received=[];
 const server=createServer(async(req,res)=>{
  let body='';for await(const part of req)body+=part;
  const payload=JSON.parse(body);received.push({path:req.url,method:req.method,
    contentType:req.headers['content-type'],payload});
  res.writeHead(200,{'content-type':'application/json'});
  res.end(JSON.stringify({stored:true,accepted:false,requestId:payload.id}));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url=`http://127.0.0.1:${server.address().port}/mobile/notify`;
 const request={id:randomUUID(),title:'Preview',contentHash:'a'.repeat(64),revisionId:'r1'};
 const persisted=[];
 try{
  assert.equal((await notifyReview(request,{url,persist:v=>persisted.push(v)})).requestId,request.id);
  assert.equal(received.length,1);
  assert.equal(received[0].path,'/mobile/notify');
  assert.equal(received[0].method,'POST');
  assert.equal(received[0].contentType,'application/json');
  assert.equal(received[0].payload.id,request.id);
  assert.equal(received[0].payload.payload.neoReviewRequestId,request.id);
  assert.deepEqual(persisted,[request]);
  await assert.rejects(()=>notifyReview(request,{url:'https://neo.example.com/mobile/notify'}),/loopback/);
  await assert.rejects(()=>notifyReview(request,{url:'http://127.0.0.1:6767/mcp'}),/loopback/);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
test('notify URL reads deployed Neo.app port and rejects remote overrides',()=>{
 const dir=mkdtempSync(join(tmpdir(),'neo-review-port-'));
 try{
  const file=join(dir,'deployment.json');writeFileSync(file,JSON.stringify({mcpPort:6808}));
  assert.equal(reviewNotifyURL({portFile:file,override:null}),
    'http://127.0.0.1:6808/mobile/notify');
  assert.throws(()=>reviewNotifyURL({portFile:file,override:'https://example.org/mobile/notify'}),/loopback/);
 }finally{rmSync(dir,{recursive:true,force:true})}
});
