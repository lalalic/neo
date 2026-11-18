import {createServer} from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {ModelStore} from './store.mjs';
import {ResponseEngine,streamResponse,failureStream} from './responses.mjs';
import {WebHelmTransport} from './webhelm.mjs';

const MAX_BODY=48*1024*1024;
const toPublic=r=>{if(!r)return null;const {sessionId,...rest}=r;return rest;};
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
const chatCompletion=r=>({id:'chatcmpl_'+r.id.slice(5),object:'chat.completion',created:r.created_at,model:r.model,
  choices:[{index:0,message:{role:'assistant',content:r.output[0]?.content?.[0]?.text??''},finish_reason:'stop'}],usage:null});
const chatChunk=(r,delta,finish_reason=null)=>({id:'chatcmpl_'+r.id.slice(5),object:'chat.completion.chunk',created:r.created_at,model:r.model,
  choices:[{index:0,delta,finish_reason}]});
export function createModelServer({token,store=new ModelStore(),transport=new WebHelmTransport(),legacyOrigin=null}={}){
  if(typeof token!=='string'||token.length<24)throw Error('private Bearer token required');
  const engine=new ResponseEngine({store,transport});
  const handler=async(req,res)=>{
    if(!authorized(req.headers.authorization,token))return json(res,401,{error:{message:'unauthorized',type:'authentication_error'}});
    const url=new URL(req.url,'http://127.0.0.1');
    if(req.method==='GET'&&url.pathname==='/v1/models')return json(res,200,{object:'list',data:[{id:'neo',object:'model',owned_by:'neo'}]});
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
    if(responsesPath&&!body.stream){
      let started=false;
      void engine.run(body,{onStarted:response=>{started=true;json(res,response.status==='completed'?200:202,toPublic(response));}})
        .catch(e=>{if(!started&&!res.headersSent)json(res,400,{error:{message:e.message,type:'model_error'}})});
      return;
    }
    if(chatPath&&!body.stream){
      try{return json(res,200,chatCompletion(await engine.run(body)))}
      catch(e){return json(res,502,{error:{message:e.message,type:'model_error'}})}
    }
    sse(res);
    let startedResponseId=null;
    const keepalive=setInterval(()=>{if(!res.writableEnded&&!res.destroyed)res.write(': keepalive\n\n');},12000);
    try{
      const result=await engine.run(body,{onStarted:r=>{
        startedResponseId=r.id;
        if(responsesPath&&!res.writableEnded)res.write(`event: response.created\ndata: ${JSON.stringify({type:'response.created',sequence_number:0,response:toPublic(r)})}\n\n`);
      }});
      if(!res.writableEnded&&!res.destroyed){
        if(responsesPath){
          const events=streamResponse(toPublic(result));
          // The create event was sent while submission began; avoid duplicating it.
          res.write(events.replace(/^event: response.created\ndata: .*?\n\n/s,''));
        }else{
          res.write('data: '+JSON.stringify(chatChunk(result,{role:'assistant'}))+'\n\n');
          res.write('data: '+JSON.stringify(chatChunk(result,{content:result.output[0]?.content?.[0]?.text??''}))+'\n\n');
          res.write('data: '+JSON.stringify(chatChunk(result,{},'stop'))+'\n\n');
          res.write('data: [DONE]\n\n');
        }
        res.end();
      }
    }catch(e){
      if(!res.writableEnded&&!res.destroyed){
        if(responsesPath)res.write(failureStream(e,startedResponseId??'unknown'));
        else res.write('data: '+JSON.stringify({error:{message:e.message,type:'model_error'}})+'\n\n');
        res.end();
      }
    }finally{clearInterval(keepalive)}
  };
  const server=createServer((req,res)=>{handler(req,res).catch(e=>{
    if(!res.headersSent)json(res,500,{error:{message:e.message,type:'internal_error'}});
    else if(!res.writableEnded)res.end();
  });});
  return {server,store,engine};
}
async function collectRaw(req){let n=0,chunks=[];for await(const chunk of req){n+=chunk.length;if(n>MAX_BODY)throw Error('request too large');chunks.push(chunk)}return Buffer.concat(chunks)}
