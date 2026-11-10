import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,writeFileSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer as httpServer} from 'node:http';
import {connect as netConnect} from 'node:net';
import {connect as tcpConnect} from 'node:net';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {createGateway} from '../gpu/web/gateway.mjs';
import {register,token,session,saveSession,tokenFile,services,service,sessionCookie,cookieValid,sessionFile} from '../gpu/web/store.mjs';
import {webAdd,webRotate} from '../gpu/web/manager.mjs';
import {GpuError,saveService} from '../gpu/common.mjs';
import {imagePlan} from '../gpu/image.mjs';
import {hfWebArgs} from '../gpu/web/providers.mjs';
const runtime=new URL('../gpu/runtime/web.mjs',import.meta.url).pathname;
function fixture(){const dir=mkdtempSync(join(tmpdir(),'neo-gpu-web-'));process.env.NEO_GPU_WEB_DIR=join(dir,'config');process.env.NEO_GPU_WEB_SESSIONS=join(dir,'sessions');process.env.NEO_GPU_REGISTRY_FILE=join(dir,'services.json');return dir;}
async function listen(server){await new Promise((ok,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',ok);});return server.address().port;}
async function close(server){await new Promise(ok=>server.close(()=>ok()));}
function controlConfig(){return {provider:'vast',image:'ghcr.io/example/demo:sha-abcdef123456',budget:2,seconds:3600,appPort:7860};}

test('32-byte random token, private file, signed cookies and rotation',()=>{
  const dir=fixture();try{
    const t=register('sample',controlConfig());
    assert.equal(Buffer.from(t,'base64url').length,32);
    assert.equal(statSync(tokenFile('sample')).mode&0o777,0o600);
    assert.equal(services().services.sample.image,controlConfig().image);
    assert.equal(JSON.stringify(services()).includes(t),false);
    const auth=sessionCookie('sample',t);
    assert.equal(cookieValid('sample',t,auth),true);
    assert.equal(cookieValid('sample','invalid',auth),false);
    assert.equal(cookieValid('other',t,auth),false);
    assert.equal(cookieValid('sample',t,auth,Date.now()+3601*1000),false);
    assert.equal(readFileSync(tokenFile('sample'),'utf8').trim(),t);
    const previous=console.log;let rotated;
    try{console.log=x=>rotated=JSON.parse(x).token;webRotate(['sample']);}
    finally{console.log=previous;}
    assert.notEqual(rotated,t);assert.equal(cookieValid('sample',rotated,auth),false);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('stable gateway is token gated, no billing on GET; start/stop require same-origin POST',async()=>{
  const dir=fixture();
  const t=register('demo',controlConfig());
  let starts=0,stops=0;
  const fake=httpServer((req,res)=>{
    if(req.headers.cookie&&req.headers.cookie.includes('neo_gpu_'))throw Error('Neo login cookie leaked to GPU app');
    res.writeHead(200,{'Content-Type':'text/plain','Location':'/next'});res.end('web says '+req.url);
  });
  const fakePort=await listen(fake);
  const origin='http://127.0.0.1:54321';
  const gw=createGateway({origin,start:()=>starts++,stop:()=>stops++,resolveBackend:async()=>({ssl:false,host:'127.0.0.1',port:fakePort})});
  const port=await listen(gw),url=`http://127.0.0.1:${port}`;
  try{
    let r=await fetch(`${url}/demo/`);assert.equal(r.status,401);assert.match(await r.text(),/Access token/);
    assert.equal(starts,0);
    r=await fetch(`${url}/demo/_login`,{method:'POST',body:new URLSearchParams({token:'wrong'}),redirect:'manual'});
    assert.equal(r.status,403);
    r=await fetch(`${url}/demo/_login`,{method:'POST',body:new URLSearchParams({token:t}),redirect:'manual'});
    assert.equal(r.status,303);assert.equal(r.headers.get('location'),'/demo/_control');
    const cookie=r.headers.get('set-cookie');assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Lax/);
    const headers={cookie:cookie.split(';')[0]};
    r=await fetch(`${url}/demo/_control`,{headers});assert.equal(r.status,200);
    assert.match(await r.text(),/60 minutes/);assert.equal(starts,0);
    r=await fetch(`${url}/demo/_start`,{method:'GET',headers});assert.equal(r.status,405);
    r=await fetch(`${url}/demo/_start`,{method:'POST',headers,redirect:'manual'});assert.equal(r.status,403);
    r=await fetch(`${url}/demo/_start`,{method:'POST',headers:{...headers,origin},redirect:'manual'});
    assert.equal(r.status,303);assert.equal(starts,1);
    saveSession('demo',{phase:'running',provider:'vast',instanceId:123,deadline:Date.now()+3600*1000});
    r=await fetch(`${url}/demo/some-path?x=1`,{headers:{...headers,cookie:headers.cookie+'; app_session=abc'}});assert.equal(r.status,200);
    assert.equal(await r.text(),'web says /some-path?x=1');
    assert.equal(r.headers.get('location'),'/demo/next');
    r=await fetch(`${url}/demo/_stop`,{method:'POST',headers:{...headers,origin},redirect:'manual'});
    assert.equal(r.status,303);assert.equal(stops,1);
    saveSession('demo',{phase:'running',provider:'vast',instanceId:123,deadline:Date.now()-1000});
    r=await fetch(`${url}/demo/`,{headers});assert.equal(r.status,200);
    assert.match(await r.text(),/Start GPU|GPU status/);
    assert.equal(starts,1); // no automatic rerental when expired
    r=await fetch(`${url}/demo/_stop`,{method:'POST',headers:{...headers,origin},redirect:'manual'});
    assert.equal(stops,2);
  }finally{await close(gw);await close(fake);rmSync(dir,{recursive:true,force:true});}
});

test('browser Start never rents HF when gateway credential is missing',async()=>{
  const dir=fixture(),secret=register('hf-guard',{...controlConfig(),provider:'hf'});
  let starts=0;
  const origin='http://127.0.0.1:54322';
  const gateway=createGateway({origin,start:()=>starts++,hfCredentialReady:()=>false});
  const port=await listen(gateway),root=`http://127.0.0.1:${port}`;
  try{
    const login=await fetch(root+'/hf-guard/_login',{method:'POST',
      body:new URLSearchParams({token:secret}),redirect:'manual'});
    assert.equal(login.status,303);
    const cookie=login.headers.get('set-cookie').split(';')[0];
    const reply=await fetch(root+'/hf-guard/_start',{method:'POST',
      headers:{Cookie:cookie,Origin:origin},redirect:'manual'});
    assert.equal(reply.status,503);
    assert.match(await reply.text(),/No paid session was started/);
    assert.equal(starts,0);
    assert.equal(session('hf-guard').phase,'stopped');
  }finally{await close(gateway);rmSync(dir,{recursive:true,force:true});}
});

test('WebSocket upgrades require a valid per-service cookie',async()=>{
  const dir=fixture(),secret=register('stream',controlConfig());
  const upstream=httpServer();
  upstream.on('upgrade',(req,socket)=>{
    socket.end('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
  });
  const upPort=await listen(upstream);
  const gw=createGateway({origin:'http://127.0.0.1:55555',resolveBackend:async()=>({ssl:false,host:'127.0.0.1',port:upPort})});
  const port=await listen(gw);
  saveSession('stream',{phase:'running',provider:'vast',instanceId:55,deadline:Date.now()+3600000});
  const raw=async(cookie='')=>await new Promise((okay,fail)=>{
    const sock=netConnect(port,'127.0.0.1');let text='';sock.setTimeout(2500,()=>{sock.destroy();fail(new Error('socket timeout'));});
    sock.on('connect',()=>sock.write('GET /stream/ws HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ZG9udGd1ZXNzMTIzNDU2Nw==\r\n'+(cookie?'Cookie: neo_gpu_stream='+cookie+'\r\n':'')+'\r\n'));
    sock.on('data',chunk=>{text+=chunk.toString();if(text.includes('\r\n\r\n')){sock.destroy();okay(text);}});
    sock.on('error',fail);
  });
  try{
    assert.match(await raw(),/^HTTP\/1\.1 401/);
    assert.match(await raw(sessionCookie('stream',secret)),/^HTTP\/1\.1 101/);
  }finally{await close(gw);await close(upstream);rmSync(dir,{recursive:true,force:true});}
});

test('runtime web mode launches Docker CMD and reverse-proxies local UI without GPU',async()=>{
  const dir=fixture();
  const app=join(dir,'app.mjs');writeFileSync(app,`import {createServer} from 'node:http';createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/plain'});res.end('app:'+req.url)}).listen(Number(process.env.NEO_GPU_APP_PORT),'127.0.0.1');`);
  const probe=httpServer();const port=await listen(probe);await close(probe);
  // The ephemeral port reserved above is released before starting the wrapper.
  const child=spawn(process.execPath,[runtime],{env:{...process.env,NEO_GPU_PORT:String(port),
    NEO_GPU_APP_PORT:'22891',NEO_GPU_BASE_PATH:'/demo/',NEO_GPU_CMD_JSON:JSON.stringify([process.execPath,app])},stdio:'ignore'});
  try{
    let ready=false;
    for(let i=0;i<90;i++){
      try{const r=await fetch(`http://127.0.0.1:${port}/health`);if(r.status===200){ready=true;break;}}
      catch{}
      await delay(70);
    }
    assert.equal(ready,true);
    const res=await fetch(`http://127.0.0.1:${port}/foo?bar=baz`);
    assert.equal(await res.text(),'app:/foo?bar=baz');
  }finally{
    const closed=new Promise(resolve=>child.once('exit',resolve));
    child.kill('SIGTERM');
    await Promise.race([closed,delay(1800).then(()=>{if(child.exitCode===null)child.kill('SIGKILL');})]);
    rmSync(dir,{recursive:true,force:true});
  }
});

test('default web session hard cap is one hour; web-only registration is enforced',()=>{
  const dir=fixture();
    try{
    assert.throws(()=>webAdd(['unbuilt']),/Build and publish/);
    saveService('my-video',{mode:'web',published:true,image:'ghcr.io/lalalic/web-demo:sha-abcdefabcdef',appPort:7860});
    const old=console.log;let output;
    try{console.log=x=>{output=JSON.parse(x);};webAdd(['my-video']);}
    finally{console.log=old;}
    assert.equal(output.hardShutdownSeconds,3600);
    assert.equal(service('my-video').seconds,3600);
    assert.equal(service('my-video').budget,2);
    assert.equal(Buffer.from(output.token,'base64url').length,32);
    assert.throws(()=>webAdd(['another','--max-seconds','7200']),/Build and publish|3600/);
    const first=imagePlan({project:resolve(new URL('..',import.meta.url).pathname),dockerfile:'gpu/examples/web/Dockerfile',mode:'web',name:'web-demo',dry_run:true});
    const second=imagePlan({project:resolve(new URL('..',import.meta.url).pathname),dockerfile:'gpu/examples/web/Dockerfile',mode:'batch',name:'web-demo',dry_run:true});
    assert.notEqual(first.image,second.image);
    assert.equal(first.appPort,7860);assert.equal(first.mode,'web');
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('HF web Job uses exact one-hour provider-side timeout, exposed private port, and executable image CMD',()=>{
  const conf={image:'ghcr.io/lalalic/web:sha-aabbccddee11',seconds:3600,flavor:'l4x1'};
  const args=hfWebArgs(conf,'neo-gpu-web-abc');
  assert.deepEqual(args.slice(-3),[conf.image,'/opt/neo-gpu/node','/opt/neo-gpu/launcher.mjs']);
  assert.equal(args[args.indexOf('--timeout')+1],'3600s');
  assert.equal(args[args.indexOf('--expose')+1],'8000');
  assert.equal(args[args.indexOf('--attempts')+1],'1');
});
