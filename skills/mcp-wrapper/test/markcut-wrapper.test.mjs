import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {federationConfiguration,operationIdFromResult,previewCall,relayControl,relayInteractiveArgs,notifyReview,reviewNotifyURL} from '../markcut.mjs';
const id=randomUUID();
const relay={jobId:'j1',taskId:'producer',executionId:'exec-1'};
const eventTemplate={type:'task.interactive_decision',source:'job/j1/task/producer/execution/exec-1',
 data:{interactive:{...relay,invocationId:id}}};
const receipt={...relay,invocationId:id,eventTemplate};
const message={jsonrpc:'2.0',id:44,method:'tools/call',params:{name:'markcut.preview',arguments:{path:'/tmp/video.md',relay}}};
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
  {control,record:(operation,bind)=>{assert.equal(operation,output.structuredContent.operationId);assert.equal(bind.invocationId,id);calls.push('persist');},
   notifyWatcher:operation=>{assert.equal(operation,output.structuredContent.operationId);calls.push('watch');}});
 assert.equal(got,output);
 assert.deepEqual(calls,['review.interactive.begin','persist','watch','review.interactive.wait']);
 assert.equal(passed[0].params.arguments.review.eventTemplate.data.interactive.invocationId,id);
 assert.equal(passed[0].params.arguments.path,'/tmp/video.md');
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
 {jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'markcut.preview',arguments:{path:'/missing.md'}}}];
 try{
  const result=await new Promise((resolve,reject)=>{
   let stdout='',stderr='';const found=[];
   const timer=setTimeout(()=>reject(Error('Proxy timed out '+stderr+' '+stdout)),9000);
   child.stdout.on('data',b=>{stdout+=b.toString();let index;
     while((index=stdout.indexOf('\n'))>=0){const line=stdout.slice(0,index);stdout=stdout.slice(index+1);
       if(line){found.push(JSON.parse(line));if(found.length===4){clearTimeout(timer);resolve(found);}}
     }});
   child.stderr.on('data',b=>{stderr+=b.toString()});
   child.on('error',reject);
   child.stdin.write(input.map(v=>JSON.stringify(v)).join('\n')+'\n');
  });
  const get=i=>result.find(r=>r.id===i);
  assert.equal(get(1).result.serverInfo.name,'mock');
  assert.match(get(2).result.tools[0].description,/Neo-hosted/);
  assert.equal(get(2).result.tools[0]._meta.ui.resourceUri,'ui://markcut/player.html');
  assert.match(get(3).result.contents[0].text,/Player/);
  assert.equal(get(4).result.isError,true);
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
     return {stdout:JSON.stringify({invocationId:id})};
   }});
 assert.equal(result.invocationId,id);
 assert.match(observed[0].binary,/agents-relay$/);
 assert.deepEqual(observed[0].args,['review','interactive','begin','--id','556',
  '--task-id','producer','--execution-id','exec-123']);
 assert.equal(observed[0].options.timeout,15000);
 assert.deepEqual(relayInteractiveArgs('review.interactive.ready',{
  jobId:'556',taskId:'producer',executionId:'exec-123',invocationId:id,revision:'e'.repeat(64)}).slice(-4),
  ['--invocation-id',id,'--revision','e'.repeat(64)]);
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
 const url=`http://127.0.0.1:${server.address().port}/mobile/review/notify`;
 const request={id:randomUUID(),title:'Preview',contentHash:'a'.repeat(64),revisionId:'r1'};
 try{
  assert.equal((await notifyReview(request,{url})).requestId,request.id);
  assert.equal(received.length,1);
  assert.equal(received[0].path,'/mobile/review/notify');
  assert.equal(received[0].method,'POST');
  assert.equal(received[0].contentType,'application/json');
  assert.deepEqual(received[0].payload,request);
  await assert.rejects(()=>notifyReview(request,{url:'https://neo.example.com/mobile/review/notify'}),/localhost/);
  await assert.rejects(()=>notifyReview(request,{url:'http://127.0.0.1:6767/mcp'}),/localhost/);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
test('notify URL reads deployed Neo.app port and rejects remote overrides',()=>{
 const dir=mkdtempSync(join(tmpdir(),'neo-review-port-'));
 try{
  const file=join(dir,'deployment.json');writeFileSync(file,JSON.stringify({mcpPort:6808}));
  assert.equal(reviewNotifyURL({portFile:file,override:null}),
    'http://127.0.0.1:6808/mobile/review/notify');
  assert.throws(()=>reviewNotifyURL({portFile:file,override:'https://example.org/mobile/review/notify'}),/loopback/);
 }finally{rmSync(dir,{recursive:true,force:true})}
});
