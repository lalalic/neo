import {createServer} from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {createOrchestratorV1Client} from './orchestrator-v1-client.mjs';
import {ModelStore} from './store.mjs';
import {OrchestratorChat} from './orchestrator-chat.mjs';
import {createOrchestratorHandoffVerifier} from './handoff-verifier.mjs';
import {ResponseEngine,ResponseSseWriter} from './responses.mjs';
import {WebHelmTransport} from './webhelm.mjs';
import {listModelCatalog} from './catalog.mjs';

const MAX_BODY=48*1024*1024;
const toPublic=r=>{if(!r)return null;const {sessionId,reports,last_activity_at,heartbeat_count,...rest}=r;return rest;};
const json=(res,status,value)=>{
  if(res.headersSent)return;
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  res.end(JSON.stringify(value));
};
const authorized=(provided,token)=>{
  const a=Buffer.from(provided??'');const b=Buffer.from('Bearer '+token);
  return a.length===b.length&&timingSafeEqual(a,b);
};
async function bodyJSON(req){
  if(!String(req.headers['content-type']??'').includes('application/json'))throw Error('application/json required');
  const chunks=[];let n=0;
  for await(const chunk of req){n+=chunk.length;if(n>MAX_BODY)throw Error('request too large');chunks.push(chunk)}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function sse(res){res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','X-Accel-Buffering':'no'});}
const fullText=r=>(r.output??[]).map(x=>x.content?.[0]?.text??'').join('\n');
const chatCompletion=r=>({id:'chatcmpl_'+r.id.slice(5),object:'chat.completion',created:r.created_at,model:r.model,
  choices:[{index:0,message:{role:'assistant',content:fullText(r)},finish_reason:'stop'}],usage:null});
const chatChunk=(r,delta,finish_reason=null)=>({id:'chatcmpl_'+r.id.slice(5),object:'chat.completion.chunk',created:r.created_at,model:r.model,
  choices:[{index:0,delta,finish_reason}]});
export function createModelServer({token,store=new ModelStore(),transport=new WebHelmTransport(),legacyOrigin=null,orchestratorBootstrapHeadFile=undefined,orchestratorNotifier=null}={}){
  if(typeof token!=='string'||token.length<24)throw Error('private Bearer token required');
  const engine=new ResponseEngine({store,transport});
  const internalGrants=new Map();
  const v1Client=createOrchestratorV1Client({
    getOrigin:()=>{
      const address=server.address();
      return address&&typeof address==='object'?'http://127.0.0.1:'+address.port:null;
    },token,grants:internalGrants,
  });
  let orchestrator=null;
  const getOrchestrator=()=>orchestrator??(orchestrator=new OrchestratorChat({store,engine:v1Client,
    verifyHandoff:createOrchestratorHandoffVerifier(),notifier:orchestratorNotifier,
    ...(orchestratorBootstrapHeadFile?{bootstrapHeadFile:orchestratorBootstrapHeadFile}:{})}));
  const handler=async(req,res)=>{
    if(!authorized(req.headers.authorization,token))return json(res,401,{error:{message:'unauthorized',type:'authentication_error'}});
    const url=new URL(req.url,'http://127.0.0.1');
    if(url.pathname.startsWith('/orchestrator-chat/')){
      try{
        const orchestrator=getOrchestrator();
        if(req.method==='POST'&&url.pathname==='/orchestrator-chat/messages'){
          const input=await bodyJSON(req);
          // Prevent proxy/header/body identity confusion. The same stable
          // client identity must own both the HTTP receipt and durable outbox.
          if(typeof req.headers['idempotency-key']!=='string'||
             req.headers['idempotency-key']!==input?.requestId)
            return json(res,400,{error:{message:'Idempotency-Key must match requestId'}});
          return json(res,202,await orchestrator.submit(input));
        }
        if(req.method==='POST'&&url.pathname==='/orchestrator-chat/attachments'){
          const input=await bodyJSON(req);
          return json(res,200,await orchestrator.upload(input));
        }
        if(req.method==='GET'&&url.pathname==='/orchestrator-chat/health'){
          const status=orchestrator.health();
          return json(res,status.ready?200:503,{...status,modelApi:'available'});
        }
        if(req.method==='GET'&&url.pathname==='/orchestrator-chat/pending'){
          // The optional read-only probe also detects already-ACKed requests.
          // No message text or file path is exposed; equality remains enforced
          // on the subsequent idempotent POST /messages.
          const requestId=url.searchParams.get('requestId');
          await orchestrator.reconcileUncertain();
          return json(res,200,{pending:orchestrator.pending(),cursor:orchestrator.state?.sequence??0,
            ...(requestId!==null?{accepted:orchestrator.accepted(requestId)}:{})});
        }
        if(req.method==='POST'&&url.pathname==='/orchestrator-chat/ack'){
          const {deliveryId}=await bodyJSON(req);return json(res,200,orchestrator.ack(deliveryId));
        }
        if(req.method==='GET'&&url.pathname==='/orchestrator-chat/events'){
          if(!orchestrator.state)return json(res,503,{error:{message:orchestrator.unavailable}});
          const rawCursor=req.headers['last-event-id']??url.searchParams.get('cursor')??'0';
          if(!/^(0|[1-9]\d{0,15})$/.test(String(rawCursor)))return json(res,400,{error:{message:'invalid event cursor'}});
          const cursor=Number(rawCursor);
          if(cursor>orchestrator.state.sequence)return json(res,400,{error:{message:'future event cursor'}});
          const oldest=orchestrator.state.events[0]?.id??orchestrator.state.sequence;
          if(cursor<oldest-1)return json(res,409,{error:{message:'event cursor expired; recover via pending'}});
          sse(res);
          // At the current cursor there are no replay bytes. Flush HTTP
          // headers immediately; otherwise the phone waits for the 15s
          // heartbeat before the SSE request resolves as connected.
          res.flushHeaders();
          const sendEvent=item=>{
            if(res.destroyed||res.writableEnded)return;
            const name=item.status==='queued'?'accepted':item.status;
            res.write(`id: ${item.id}\nevent: message.${name}\ndata: ${JSON.stringify(item)}\n\n`);
          };
          orchestrator.listeners.add(sendEvent);
          // Subscribe before replay; the JS event loop serializes writer registration and replay.
          for(const item of orchestrator.eventsAfter(cursor))sendEvent(item);
          const heartbeat=setInterval(()=>{if(!res.destroyed&&!res.writableEnded)res.write(': keepalive\n\n')},15000);
          // IncomingMessage 'close' can fire when the GET request has been
          // fully received, even though the SSE response remains open.
          // Retain the live listener until the RESPONSE stream closes.
          res.once('close',()=>{clearInterval(heartbeat);orchestrator.listeners.delete(sendEvent)});
          return;
        }
        return json(res,404,{error:{message:'not found'}});
      }catch(e){return json(res,e.message==='requestId conflict'?409:
        /unavailable|not verified|retention capacity/.test(e.message)?503:400,{error:{message:e.message}})}
    }
    if(req.method==='GET'&&url.pathname==='/v1/models')return json(res,200,listModelCatalog(url.searchParams));
    // Keep independently implemented 3D provider routes reachable through the
    // generic service without importing project-specific modules or prompts.
    const legacyRoute=url.pathname.startsWith('/api/v2/rodin')||['/api/v2/status','/api/v2/download'].includes(url.pathname);
    const legacyResponse=req.method==='GET'&&/^\/v1\/responses\/resp_[a-f0-9]{40}$/.test(url.pathname)&&!store.response(url.pathname.split('/').at(-1));
    if(legacyRoute||legacyResponse){
      if(!legacyOrigin)return json(res,503,{error:{message:'configured provider unavailable'}});
      try{
        const headers={authorization:req.headers.authorization};
        if(req.headers['content-type'])headers['content-type']=req.headers['content-type'];
        const upstream=await fetch(legacyOrigin+url.pathname+url.search,{method:req.method,headers,
          ...(req.method==='GET'?{}:{body:await collectRaw(req)}),redirect:'manual'});
        if(upstream.status>=300&&upstream.status<400)return json(res,502,{error:{message:'upstream redirects disallowed'}});
        res.writeHead(upstream.status,{'content-type':upstream.headers.get('content-type')??'application/json','cache-control':'no-store'});
        if(upstream.body)for await(const chunk of upstream.body)res.write(chunk);
        return res.end();
      }catch(e){return json(res,502,{error:{message:'provider unavailable',type:'upstream_error'}})}
    }
    if(req.method==='GET'&&/^\/v1\/responses\/resp_[a-f0-9]{40}$/.test(url.pathname)){
      const value=store.response(url.pathname.split('/').at(-1));
      return value?json(res,200,toPublic(value)):json(res,404,{error:{message:'unknown response'}});
    }
    const responsesPath=url.pathname==='/v1/responses'&&req.method==='POST';
    const chatPath=url.pathname==='/v1/chat/completions'&&req.method==='POST';
    if(!responsesPath&&!chatPath)return json(res,404,{error:{message:'not found'}});
    let body;
    try{body=await bodyJSON(req)}catch(e){return json(res,400,{error:{message:e.message,type:'invalid_request_error'}})}
    if(chatPath)body={...body,input:body.messages};
    if(body.model!=='neo')return json(res,400,{error:{message:'unsupported model (use neo)'}});
    // Codex sends a stable conversation identity on Responses HTTP requests.
    // Thread ID (not cache/session ID, and never transcript text) owns routing.
    const headerIds=[req.headers['thread-id'],req.headers.thread_id].filter(Boolean);
    if(headerIds.length>1&&headerIds.some(id=>id!==headerIds[0]))
      return json(res,400,{error:{message:'conflicting Codex Thread headers',type:'invalid_request_error'}});
    const codexThreadId=headerIds[0]??null;
    if(codexThreadId&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(codexThreadId))
      return json(res,400,{error:{message:'invalid Codex Thread header',type:'invalid_request_error'}});
    // One-shot, in-process grant: only the Orchestrator /v1 client can pass
    // attachment paths to ResponseEngine. The generic API remains unchanged.
    const privateGrant=req.headers['x-neo-orchestrator-grant'];
    let attachmentFiles=[];
    if(privateGrant!==undefined){
      const grant=typeof privateGrant==='string'?internalGrants.get(privateGrant):null;
      if(!grant||grant.codexThreadId!==codexThreadId)
        return json(res,403,{error:{message:'unauthorized private /v1 request',type:'authentication_error'}});
      internalGrants.delete(privateGrant);
      attachmentFiles=grant.attachmentFiles;
    }
    if(!codexThreadId&&(req.headers['session-id']||req.headers.session_id))
      return json(res,400,{error:{message:'Codex Thread ID required; session-id is not a Thread identity',type:'invalid_request_error'}});
    if(responsesPath&&!body.stream){
      let started=false;
      void engine.run(body,{codexThreadId,attachmentFiles,onStarted:response=>{started=true;json(res,response.status==='completed'?200:202,toPublic(response));}})
        .catch(e=>{if(!started&&!res.headersSent)json(res,400,{error:{message:e.message,type:'model_error'}})});
      return;
    }
    if(chatPath&&!body.stream){
      try{return json(res,200,chatCompletion(await engine.run(body,{codexThreadId,attachmentFiles})))}
      catch(e){return json(res,502,{error:{message:e.message,type:'model_error'}})}
    }
    sse(res);
    let startedResponseId=null,watcher=null,chatSeen=0,chatStarted=false,chatFinished=false;
    const send=chunk=>{if(!res.writableEnded&&!res.destroyed)res.write(chunk)};
    const responsesWriter=responsesPath?new ResponseSseWriter(send):null;
    const chatPacket=(chunk)=>send('data: '+JSON.stringify(chunk)+'\n\n');
    const pump=()=>{
      if(!startedResponseId||res.writableEnded||res.destroyed)return;
      const snapshot=store.response(startedResponseId);
      if(!snapshot)return;
      const value=toPublic(snapshot);
      if(responsesPath){
        if(responsesWriter.update(snapshot))res.end();
        return;
      }
      if(!chatStarted){chatPacket(chatChunk(value,{role:'assistant'}));chatStarted=true;}
      const content=fullText(value);
      if(content.length>chatSeen){
        chatPacket(chatChunk(value,{content:content.slice(chatSeen)}));
        chatSeen=content.length;
      }
      if(value.status==='completed'&&!chatFinished){
        chatPacket(chatChunk(value,{},'stop'));
        send('data: [DONE]\n\n');chatFinished=true;res.end();
      }else if(value.status==='failed'&&!chatFinished){
        chatPacket({error:{message:value.error?.message??'model failed',type:'model_error'}});
        chatFinished=true;res.end();
      }
    };
    const keepalive=setInterval(()=>send(': keepalive\n\n'),12000);
    try{
      const result=await engine.run(body,{codexThreadId,attachmentFiles,onStarted:r=>{
        startedResponseId=r.id;
        if(responsesPath)responsesWriter.start(toPublic(r));
        watcher=setInterval(pump,100);
        pump();
      }});
      pump();
      if(!res.writableEnded&&!res.destroyed){
        // Older transports can return after an unexpected state transition;
        // they must not turn a partial report into an implicit success.
        if(responsesPath&&!responsesWriter.terminal)responsesWriter.fail(Error('missing explicit completion'),result.id);
        if(!responsesPath&&!chatFinished)chatPacket({error:{message:'missing explicit completion',type:'model_error'}});
        res.end();
      }
    }catch(e){
      if(!res.writableEnded&&!res.destroyed){
        pump();
        if(responsesPath&&!responsesWriter.terminal)responsesWriter.fail(e,startedResponseId??'unknown');
        if(!responsesPath&&!chatFinished)chatPacket({error:{message:e.message,type:'model_error'}});
        res.end();
      }
    }finally{clearInterval(keepalive);if(watcher)clearInterval(watcher)}
  };
  const server=createServer((req,res)=>{handler(req,res).catch(e=>{
    if(!res.headersSent)json(res,500,{error:{message:e.message,type:'internal_error'}});
    else if(!res.writableEnded)res.end();
  });});
  return {server,store,engine,getOrchestrator,get orchestrator(){return orchestrator;}};
}
async function collectRaw(req){let n=0,chunks=[];for await(const chunk of req){n+=chunk.length;if(n>MAX_BODY)throw Error('request too large');chunks.push(chunk)}return Buffer.concat(chunks)}
