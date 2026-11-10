import {createServer,request as httpRequest} from 'node:http';
import {request as httpsRequest} from 'node:https';
import {spawn} from 'node:child_process';
import {openSync,closeSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {GpuError} from '../common.mjs';
import {hubToken} from '../transport.mjs';
import {tunnelFor} from '../providers/vast.mjs';
import {sessionRoot,service,session,token,safeMatch,sessionCookie,cookieValid,cookieFromHeader,cookieName} from './store.mjs';

const htmlSafe=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const tunnels=new Map();
const pendingTunnels=new Map();
function page(title,body){return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${htmlSafe(title)} – Neo GPU</title><style>body{font:16px system-ui,sans-serif;max-width:560px;margin:8vh auto;padding:0 20px;color:#20232b}main{border:1px solid #ddd;border-radius:14px;padding:24px}button,input{font:inherit;padding:12px;border-radius:8px}input{box-sizing:border-box;width:100%;border:1px solid #aaa}button{background:#252e42;color:white;border:0;cursor:pointer;margin-top:12px}a{color:#2358a1}.muted{color:#60646c}form{margin:14px 0}</style></head><body><main><h2>${htmlSafe(title)}</h2>${body}</main></body></html>`;}
function text(res,status,body,headers={}){
  res.writeHead(status,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store',
    'Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    'X-Content-Type-Options':'nosniff',...headers});res.end(body);
}
function redirect(res,url,headers={}){res.writeHead(303,{'Location':url,'Cache-Control':'no-store',...headers});res.end();}
function postForm(req,limit=2048){return new Promise((resolve,reject)=>{
  let count=0,parts=[];req.on('data',chunk=>{count+=chunk.length;if(count>limit){reject(new Error('form_too_large'));req.destroy();return;}parts.push(chunk);});
  req.on('end',()=>resolve(new URLSearchParams(Buffer.concat(parts).toString('utf8'))));req.on('error',reject);
});}
function login(name){return page(`Unlock ${name}`,`<p class="muted">Enter the service's random access token. This token also permits starting a paid GPU session.</p><form method="post" action="/${name}/_login"><label>Access token<input name="token" type="password" autocomplete="off" required autofocus></label><button type="submit">Unlock</button></form>`);}
function control(name,config,state){
  const active=state.phase==='running'&&Date.now()<state.deadline;
  const remaining=active?Math.max(0,Math.ceil((state.deadline-Date.now())/60000)):0;
  const budget=Number(config.budget).toFixed(2);
  const caption=active?`<p>GPU running · hard shutdown in at most <strong>${remaining} minutes</strong>.</p><p><a href="/${name}/">Open application</a></p>`:
    `<p>GPU status: <strong>${htmlSafe(state.phase||'stopped')}</strong>. Visiting this URL does not rent a GPU.</p>`;
  const actions=active?`<form method="post" action="/${name}/_stop"><button type="submit">Stop GPU now</button></form>`:
    state.phase==='stopped'||state.phase==='failed'?`<form method="post" action="/${name}/_start"><button type="submit">Start GPU (paid session)</button></form>`:
    `<p class="muted">Session transition in progress. <a href="/${name}/_control">Refresh status</a>.</p>`;
  return page(name,`${caption}<p class="muted">Provider: ${htmlSafe(config.provider)} · Budget preflight: US$${budget} · Hard timeout: ${config.seconds/60} minutes. Budget is not a provider-enforced hard cap.</p>${actions}`);
}
function sessionAuth(name,req){
  try{return cookieValid(name,token(name),cookieFromHeader(name,req.headers.cookie));}catch{return false;}
}
function startAction(name,action){
  mkdirSync(join(sessionRoot(),'logs'),{recursive:true,mode:0o700});
  const file=join(sessionRoot(),'logs',`${name}.log`);
  const fd=openSync(file,'a',0o600);
  const child=spawn(process.execPath,[new URL('../cli.mjs',import.meta.url).pathname,'web',action,name,
    ...(action==='start'?['--allow-spend']:[])],{stdio:['ignore',fd,fd],detached:true,env:process.env});
  closeSync(fd);child.unref();
}
function upstreamHeaders(req,name,state,origin){
  const h={...req.headers};
  const applicationAuth=h.authorization;
  const applicationCookies=String(h.cookie||'').split(';').map(x=>x.trim()).filter(x=>x&&!x.startsWith(cookieName(name)+'='));
  for(const key of ['cookie','authorization','proxy-authorization','connection','host','forwarded','x-forwarded-host','x-neo-app-authorization'])delete h[key];
  if(applicationCookies.length)h.cookie=applicationCookies.join('; ');
  if(typeof applicationAuth==='string')h['x-neo-app-authorization']=applicationAuth;
  h['x-forwarded-prefix']='/'+name;
  h['x-forwarded-proto']='https';
  h['x-forwarded-host']=new URL(origin).host;
  if(state.provider==='hf')h.authorization='Bearer '+hubToken();
  return h;
}
async function backendFor(name,state){
  if(state.provider==='hf'){
    if(!/^[a-f0-9]{24}$/.test(state.jobId||''))throw new Error('missing_hf_job_id');
    return {ssl:true,host:`${state.jobId}--8000.hf.jobs`,port:443,sessionId:state.jobId};
  }
  if(state.provider==='vast'){
    const id=state.instanceId;
    if(!Number.isInteger(id)||id<1)throw new Error('missing_vast_id');
    const existing=tunnels.get(name);
    if(existing&&existing.id===id&&existing.tunnel.exitCode===null)return {ssl:false,host:'127.0.0.1',port:existing.port,sessionId:id};
    if(!pendingTunnels.has(name)){
      const promise=tunnelFor(id,Math.min(state.deadline-120000,Date.now()+420000),
        process.env.NEO_GPU_VAST_SSH_KEY||`${process.env.HOME}/.ssh/id_ed25519`,'neo-gpu-web-v1')
        .then(t=>{tunnels.set(name,{...t,id});pendingTunnels.delete(name);return t;})
        .catch(()=>{pendingTunnels.delete(name);});
      pendingTunnels.set(name,promise);
    }
    throw new Error('vast_tunnel_starting');
  }
  throw new Error('invalid_provider');
}
function dropTunnel(name){const t=tunnels.get(name);if(t?.tunnel)t.tunnel.kill();tunnels.delete(name);}
function proxyRequest(req,res,name,state,backend,origin){
  const path=req.url.slice(name.length+1)||'/';
  const headers=upstreamHeaders(req,name,state,origin);
  headers.host=backend.ssl?backend.host:`${backend.host}:${backend.port}`;
  const request=(backend.ssl?httpsRequest:httpRequest)({hostname:backend.host,port:backend.port,
    path,method:req.method,headers,timeout:900000},remote=>{
    const responseHeaders={...remote.headers};
    const location=responseHeaders.location;
    if(typeof location==='string'&&location.startsWith('/')&&!location.startsWith('//'))
      responseHeaders.location=`/${name}${location}`;
    if(responseHeaders['set-cookie'])responseHeaders['set-cookie']=responseHeaders['set-cookie'].map(c=>
      /;\s*path=/i.test(c)?c.replace(/;\s*path=[^;]*/i,`; Path=/${name}/`):c+`; Path=/${name}/`);
    res.writeHead(remote.statusCode,responseHeaders);remote.pipe(res);
  });
  request.on('timeout',()=>request.destroy());
  request.on('error',()=>{if(!res.headersSent)text(res,502,control(name,service(name),session(name)));else res.destroy();});
  req.pipe(request);
}
function denySocket(socket,code=401){socket.end(`HTTP/1.1 ${code} Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`);}
function proxyWebsocket(req,socket,head,name,state,backend,origin){
  const path=req.url.slice(name.length+1)||'/';
  const headers=upstreamHeaders(req,name,state,origin);
  headers.connection='Upgrade';headers.upgrade='websocket';
  headers.host=backend.ssl?backend.host:`${backend.host}:${backend.port}`;
  const request=(backend.ssl?httpsRequest:httpRequest)({hostname:backend.host,port:backend.port,
    path,method:'GET',headers,timeout:30000});
  request.on('upgrade',(response,remote,remoteHead)=>{
    let header=`HTTP/1.1 ${response.statusCode} Switching Protocols\r\n`;
    for(const [key,value] of Object.entries(response.headers))header+=`${key}: ${Array.isArray(value)?value.join(', '):value}\r\n`;
    socket.write(header+'\r\n');if(remoteHead.length)socket.write(remoteHead);if(head.length)remote.write(head);
    remote.pipe(socket).pipe(remote);
    const close=()=>{socket.destroy();remote.destroy();};
    socket.on('error',close);remote.on('error',close);
  });
  request.on('response',()=>denySocket(socket,502));
  request.on('error',()=>denySocket(socket,502));request.end();
}
export function createGateway({origin='https://gpu.qili2.com',start=startAction,stop=startAction,
  resolveBackend=backendFor,hfCredentialReady=()=>{try{return Boolean(hubToken());}catch{return false;}}}={}){
  const base=new URL(origin).origin;
  const server=createServer(async(req,res)=>{
    try{
      const parsed=new URL(req.url,'http://localhost');
      if(parsed.pathname==='/health'){return text(res,200,'OK');}
      const parts=/^\/([a-z][a-z0-9-]{0,63})(?:\/(.*))?$/.exec(parsed.pathname);
      if(!parts||!service(parts[1]))return text(res,404,page('Not found','Unknown GPU service'));
      const name=parts[1],config=service(name);
      if(!parsed.pathname.endsWith('/')&&!parts[2])return redirect(res,`/${name}/`);
      if(req.method==='POST'&&parts[2]==='_login'){
        const form=await postForm(req);
        if(!safeMatch(form.get('token'),token(name)))return text(res,403,page('Access denied','Incorrect token'));
        const value=sessionCookie(name,token(name));
        const cookie=`${cookieName(name)}=${value}; HttpOnly; SameSite=Lax; Path=/${name}/; Max-Age=3600${base.startsWith('https:')?'; Secure':''}`;
        return redirect(res,`/${name}/_control`,{'Set-Cookie':cookie});
      }
      if(!sessionAuth(name,req))return text(res,401,login(name));
      const state=session(name);
      if(['_start','_stop'].includes(parts[2])){
        if(req.method!=='POST')return text(res,405,page('Method not allowed','POST required'));
        if(req.headers.origin!==base)return text(res,403,page('Forbidden','Origin mismatch'));
        if(parts[2]==='_start'&&!['stopped','failed'].includes(state.phase))return redirect(res,`/${name}/_control`);
        if(parts[2]==='_stop'&&!['running','cleanup_failed'].includes(state.phase))return redirect(res,`/${name}/_control`);
        if(parts[2]==='_start'&&config.provider==='hf'&&!hfCredentialReady())
          return text(res,503,page('Gateway credential unavailable',
            'HF private proxy authentication is not configured for this gateway. No paid session was started.'));

        (parts[2]==='_start'?start:stop)(name,parts[2].slice(1));
        return redirect(res,`/${name}/_control`);
      }
      if(parts[2]==='_control')return text(res,200,control(name,config,state));
      if(state.phase!=='running'||Date.now()>=state.deadline){dropTunnel(name);return text(res,200,control(name,config,state));}
      try{const backend=await resolveBackend(name,state);return proxyRequest(req,res,name,state,backend,base);}
      catch{return text(res,503,control(name,config,state));}
    }catch{return text(res,500,page('Service unavailable','Internal gateway error'));}
  });
  server.on('upgrade',async(req,socket,head)=>{
    try{
      const parsed=new URL(req.url,'http://localhost');
      const match=/^\/([a-z][a-z0-9-]{0,63})\//.exec(parsed.pathname);
      if(!match||!service(match[1])||!sessionAuth(match[1],req))return denySocket(socket);
      const name=match[1],state=session(name);
      if(state.phase!=='running'||Date.now()>=state.deadline)return denySocket(socket,503);
      const backend=await resolveBackend(name,state);
      proxyWebsocket(req,socket,head,name,state,backend,base);
    }catch{denySocket(socket,503);}
  });
  server.on('close',()=>{for(const name of tunnels.keys())dropTunnel(name);});
  return server;
}
