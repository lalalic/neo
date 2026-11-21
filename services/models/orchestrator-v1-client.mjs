import {randomUUID} from 'node:crypto';

const RESPONSE=/^resp_[a-f0-9]{40}$/;
const THREAD=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_SSE_EVENT=1_048_576;

/**
 * Orchestrator is a private client of the SAME authenticated /v1/responses
 * service, not an alternate ResponseEngine execution or reply consumer.
 * The one-shot, unguessable grant only passes already-verified local files
 * through the private Models process; no file path enters the HTTP JSON body.
 */
export function createOrchestratorV1Client({getOrigin,token,grants,fetchImpl=fetch}={}){
  if(typeof getOrigin!=='function'||typeof token!=='string'||!grants)throw Error('Invalid private /v1 client');
  return {
    async run(body,{codexThreadId,attachmentFiles=[],onResponseStarted}={}){
      if(!THREAD.test(codexThreadId??''))throw Error('Orchestrator fixed Codex Thread UUID required');
      if(!Array.isArray(attachmentFiles)||attachmentFiles.length>4||
         attachmentFiles.some(file=>typeof file!=='string'||!file.startsWith('/')))
        throw Error('Invalid verified attachment files');
      const origin=getOrigin();
      if(!/^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(origin??''))
        throw Error('Private Models listener is unavailable');
      const grant=randomUUID();
      grants.set(grant,{codexThreadId,attachmentFiles});
      let response;
      try{
        response=await fetchImpl(origin+'/v1/responses',{
          method:'POST',
          headers:{
            'Authorization':'Bearer '+token,
            'Content-Type':'application/json',
            'thread-id':codexThreadId,
            'x-neo-orchestrator-grant':grant,
          },
          body:JSON.stringify({...body,model:'neo',stream:true}),
          redirect:'manual',
          signal:AbortSignal.timeout(30*60*1000),
        });
        if(response.status!==200||!response.body||
           !String(response.headers.get('content-type')??'').startsWith('text/event-stream')){
          throw Error('Internal /v1 stream unavailable (HTTP '+response.status+')');
        }
        let buffer='',startedId=null;
        const decoder=new TextDecoder();
        for await(const bytes of response.body){
          buffer+=decoder.decode(bytes,{stream:true});
          if(buffer.length>MAX_SSE_EVENT)throw Error('Internal /v1 event exceeds maximum size');
          for(;;){
            const boundary=buffer.indexOf('\n\n');
            if(boundary<0)break;
            const frame=buffer.slice(0,boundary).replace(/\r/g,'');
            buffer=buffer.slice(boundary+2);
            const event=frame.split('\n').find(line=>line.startsWith('event: '))?.slice(7);
            const json=frame.split('\n').filter(line=>line.startsWith('data: ')).map(line=>line.slice(6)).join('\n');
            if(!event||!json)continue;
            let packet;
            try{packet=JSON.parse(json)}catch{throw Error('Malformed internal /v1 SSE event')}
            if(event==='response.created'){
              const id=packet?.response?.id;
              if(!RESPONSE.test(id??'')||startedId)throw Error('Invalid or duplicate internal /v1 response identity');
              startedId=id;
              onResponseStarted?.(id);
            }
            if(event==='response.failed')throw Error('Internal /v1 response failed: '+String(packet?.response?.error?.message??'unknown').slice(0,240));
            if(event==='response.completed'){
              if(!startedId||packet?.response?.id!==startedId||packet.response.status!=='completed')
                throw Error('Internal /v1 completion does not match the started response');
              return packet.response;
            }
          }
        }
        throw Error('Internal /v1 stream ended without explicit completion');
      }finally{
        grants.delete(grant);
        await response?.body?.cancel().catch(()=>{});
      }
    },
  };
}
