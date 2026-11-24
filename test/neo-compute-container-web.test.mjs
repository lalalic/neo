import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,writeFileSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer as httpServer} from 'node:http';
import {connect as netConnect} from 'node:net';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
const runtime=new URL('../compute/runtime/web.mjs',import.meta.url).pathname;
function fixture(){const dir=mkdtempSync(join(tmpdir(),'neo-gpu-web-'));process.env.NEO_COMPUTE_WEB_DIR=join(dir,'config');process.env.NEO_COMPUTE_WEB_SESSIONS=join(dir,'sessions');process.env.NEO_COMPUTE_REGISTRY_FILE=join(dir,'services.json');return dir;}
async function listen(server){await new Promise((ok,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',ok);});return server.address().port;}
async function close(server){await new Promise(ok=>server.close(()=>ok()));}

test('runtime web mode launches Docker CMD and reverse-proxies local UI without GPU',async()=>{
  const dir=fixture();
  const app=join(dir,'app.mjs');writeFileSync(app,`import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
const s=createServer(async(req,res)=>{
  if(req.url==='/credentials'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({authorization:req.headers.authorization||null,provider:req.headers['proxy-authorization']||null,forwarded:req.headers['x-neo-app-authorization']||null,prefix:req.headers['x-forwarded-prefix'],host:req.headers.host}));}
  if(req.url==='/stream'){res.writeHead(200,{'Content-Type':'text/plain'});res.write('first');setTimeout(()=>res.end('second'),300);return;}
  if(req.url==='/body'){for await(const c of req)res.write(c);return res.end();}
  res.writeHead(200,{'Content-Type':'text/plain'});res.end('app:'+req.url);
});
s.on('upgrade',(req,socket,head)=>{
  const accept=createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\\r\\nConnection: Upgrade\\r\\nUpgrade: websocket\\r\\nSec-WebSocket-Accept: '+accept+'\\r\\n\\r\\n');
  // Echo a small WebSocket message as an unmasked server text frame.
  let buffer=head;const echo=()=>{if(buffer.length<6)return;const len=buffer[1]&127;if(buffer.length<6+len)return;const data=Buffer.from(buffer.subarray(6,6+len));for(let i=0;i<len;i++)data[i]^=buffer[2+i%4];socket.write(Buffer.concat([Buffer.from([0x81,len]),data]));buffer=buffer.subarray(6+len);};echo();
  socket.on('data',c=>{buffer=Buffer.concat([buffer,c]);echo()});
});
s.listen(Number(process.env.NEO_GPU_APP_PORT),'127.0.0.1');`);
  const probe=httpServer();const port=await listen(probe);await close(probe);
  const appProbe=httpServer();const appPort=await listen(appProbe);await close(appProbe);
  // Both ephemeral ports are released before starting the wrapper.
  const child=spawn(process.env.NEO_COMPUTE_RUNTIME_BIN||process.execPath,process.env.NEO_COMPUTE_RUNTIME_BIN?[]:[runtime],{env:{...process.env,NEO_GPU_MODE:'web',NEO_GPU_PORT:String(port),
    NEO_GPU_APP_PORT:String(appPort),NEO_GPU_BASE_PATH:'/demo/',NEO_GPU_CMD_JSON:JSON.stringify([process.execPath,app])},stdio:'ignore'});
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
    const base='http://127.0.0.1:'+port;
    const creds=await(await fetch(base+'/credentials',{headers:{Authorization:'Bearer provider','Proxy-Authorization':'secret','X-Neo-App-Authorization':'Bearer app','X-Forwarded-Prefix':'/valid-prefix'}})).json();
    assert.deepEqual(creds,{authorization:'Bearer app',provider:null,forwarded:null,prefix:'/valid-prefix',host:'127.0.0.1:'+appPort});
    const stripped=await(await fetch(base+'/credentials',{headers:{Authorization:'Bearer provider','X-Forwarded-Prefix':'/bad/path'}})).json();
    assert.equal(stripped.authorization,null);assert.equal(stripped.prefix,'/demo/');
    const payload=Buffer.alloc(256*1024,0x64);
    const echo=await fetch(base+'/body',{method:'POST',body:payload});
    assert.deepEqual(Buffer.from(await echo.arrayBuffer()),payload);
    const streaming=await fetch(base+'/stream');
    const reader=streaming.body.getReader();
    const first=await reader.read();
    assert.equal(Buffer.from(first.value).toString(),'first');
    let tail='';while(true){const next=await reader.read();if(next.done)break;tail+=Buffer.from(next.value).toString();}
    assert.equal(tail,'second');
    // Raw upgrade handshake + masked client frame, including an early frame
    // in the same TCP write as the headers.
    await new Promise((resolve,reject)=>{
      const socket=netConnect(port,'127.0.0.1');let chunks=Buffer.alloc(0);
      const key='dGhlIHNhbXBsZSBub25jZQ==', mask=Buffer.from([1,2,3,4]), data=Buffer.from('ping');
      for(let i=0;i<data.length;i++)data[i]^=mask[i%4];
      const frame=Buffer.concat([Buffer.from([0x81,0x84]),mask,data]);
      socket.setTimeout(3000,()=>socket.destroy(Error('WebSocket timeout')));
      socket.on('error',reject);
      socket.on('connect',()=>socket.write(Buffer.concat([Buffer.from('GET /ws HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: '+key+'\r\n\r\n'),frame])));
      socket.on('data',c=>{chunks=Buffer.concat([chunks,c]);const i=chunks.indexOf('\r\n\r\n');if(i<0||chunks.length<i+10)return;
        try{const head=chunks.subarray(0,i).toString();assert.match(head,/HTTP\/1\.1 101/);assert.ok(head.includes(createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')));
          assert.deepEqual(chunks.subarray(i+4,i+10),Buffer.concat([Buffer.from([0x81,4]),Buffer.from('ping')]));socket.destroy();resolve();}catch(e){socket.destroy();reject(e);}
      });
    });

  }finally{
    const closed=new Promise(resolve=>child.once('exit',resolve));
    child.kill('SIGTERM');
    await Promise.race([closed,delay(1800).then(()=>{if(child.exitCode===null)child.kill('SIGKILL');})]);
    rmSync(dir,{recursive:true,force:true});
  }
});

