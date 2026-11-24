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
const runtime=new URL('../compute/runtime/web.mjs',import.meta.url).pathname;
function fixture(){const dir=mkdtempSync(join(tmpdir(),'neo-gpu-web-'));process.env.NEO_COMPUTE_WEB_DIR=join(dir,'config');process.env.NEO_COMPUTE_WEB_SESSIONS=join(dir,'sessions');process.env.NEO_COMPUTE_REGISTRY_FILE=join(dir,'services.json');return dir;}
async function listen(server){await new Promise((ok,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',ok);});return server.address().port;}
async function close(server){await new Promise(ok=>server.close(()=>ok()));}

test('runtime web mode launches Docker CMD and reverse-proxies local UI without GPU',async()=>{
  const dir=fixture();
  const app=join(dir,'app.mjs');writeFileSync(app,`import {createServer} from 'node:http';createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/plain'});res.end('app:'+req.url)}).listen(Number(process.env.NEO_GPU_APP_PORT),'127.0.0.1');`);
  const probe=httpServer();const port=await listen(probe);await close(probe);
  const appProbe=httpServer();const appPort=await listen(appProbe);await close(appProbe);
  // Both ephemeral ports are released before starting the wrapper.
  const child=spawn(process.execPath,[runtime],{env:{...process.env,NEO_GPU_PORT:String(port),
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
  }finally{
    const closed=new Promise(resolve=>child.once('exit',resolve));
    child.kill('SIGTERM');
    await Promise.race([closed,delay(1800).then(()=>{if(child.exitCode===null)child.kill('SIGKILL');})]);
    rmSync(dir,{recursive:true,force:true});
  }
});

