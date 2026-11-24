// Generic web-app wrapper for Neo GPU containers. The project's Docker CMD
// starts its UI on the internal APP_PORT; the only exposed port is 8000.
import {spawn} from 'node:child_process';
import {createServer,request as httpRequest} from 'node:http';
import {connect} from 'node:net';
const port=Number(process.env.NEO_GPU_PORT||8000);
const appPort=Number(process.env.NEO_GPU_APP_PORT||7860);
const command=(()=>{try{return JSON.parse(process.env.NEO_GPU_CMD_JSON||'[]');}catch{return [];}})();
if(!Array.isArray(command)||!command.length||!command.every(x=>typeof x==='string')||
  !Number.isInteger(appPort)||appPort<1||appPort>65535||appPort===port){
  console.error('Invalid Neo GPU web runtime configuration');process.exit(2);
}
const child=spawn(command[0],command.slice(1),{
  shell:false,stdio:'inherit',env:{...process.env,PORT:String(appPort),NEO_GPU_APP_PORT:String(appPort)}});
let exited=false;
child.on('error',e=>{console.error('Web application failed to launch:',e.message);exited=true;});
child.on('exit',()=>{exited=true;});
function proxyHeaders(headers){
  const clean={...headers,host:`127.0.0.1:${appPort}`};
  // The provider Bearer credential is stripped. A separate app credential,
  // explicitly forwarded by Neo Gateway, is restored for the web application.
  const original=clean['x-neo-app-authorization'];
  delete clean.authorization;delete clean['x-neo-app-authorization'];
  delete clean['proxy-authorization'];
  if(typeof original==='string')clean.authorization=original;
  clean['x-forwarded-prefix']=reqPrefix(headers);
  return clean;
}
function reqPrefix(headers) {
  const value=headers['x-forwarded-prefix'];
  if(typeof value==='string' && /^\/[a-z][a-z0-9-]{0,63}$/.test(value)) return value;
  return process.env.NEO_GPU_BASE_PATH||'/';
}
const server=createServer((req,res)=>{
  if(req.url==='/health'){
    if(exited){res.writeHead(503);res.end(JSON.stringify({ok:false,service:'neo-gpu-web-v1',phase:'exited'}));return;}
    const probe=httpRequest({host:'127.0.0.1',port:appPort,path:'/',method:'HEAD',timeout:3000},r=>{
      r.resume();res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});
      res.end(JSON.stringify({ok:true,service:'neo-gpu-web-v1'}));
    });
    probe.on('error',()=>{res.writeHead(503);res.end(JSON.stringify({ok:false,service:'neo-gpu-web-v1',phase:'starting'}));});
    probe.on('timeout',()=>probe.destroy());probe.end();return;
  }
  const upstream=httpRequest({host:'127.0.0.1',port:appPort,path:req.url,method:req.method,
    headers:proxyHeaders(req.headers)},response=>{
    res.writeHead(response.statusCode,response.headers);response.pipe(res);
  });
  upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end('GPU application unavailable');});
  req.pipe(upstream);
});
server.on('upgrade',(req,socket,head)=>{
  const up=connect(appPort,'127.0.0.1');
  up.once('connect',()=>{
    let initial=`${req.method} ${req.url} HTTP/1.1\r\n`;
    for(const [key,value] of Object.entries(proxyHeaders(req.headers))){
      initial+=`${key}: ${Array.isArray(value)?value.join(', '):value}\r\n`;
    }
    up.write(initial+'\r\n');if(head.length)up.write(head);
    socket.pipe(up).pipe(socket);
  });
  const close=()=>{socket.destroy();up.destroy();};
  socket.on('error',close);up.on('error',close);
});
server.listen(port,'0.0.0.0',()=>console.log(`NEO_GPU_WEB_READY port=${port} app=${appPort}`));
let shuttingDown=false;
const shutdown=()=>{
  if(shuttingDown)return;
  shuttingDown=true;
  child.kill('SIGTERM');
  server.closeAllConnections();
  server.close(()=>{process.exitCode=0;});
  // In-flight WebSockets or a misbehaving child must not keep a GPU alive.
  const timer=setTimeout(()=>{
    if(child.exitCode===null)child.kill('SIGKILL');
    process.exit(0);
  },1200);
  timer.unref();
};
process.on('SIGTERM',shutdown);
process.on('SIGINT',shutdown);
