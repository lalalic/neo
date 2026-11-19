import {key,assertInput,materializeImages,compact} from './input.mjs';
import {join} from 'node:path';
import {createTurnPrompt} from './prompt.mjs';
import {canonicalModel} from './catalog.mjs';
const event=(type,obj)=>`event: ${type}\ndata: ${JSON.stringify({type,...obj})}\n\n`;

// Reports are independent output_text deltas of one assistant message.
// SSE sequence numbers remain continuous across live reports and completion.
export class ResponseSseWriter {
  constructor(write){this.write=write;this.sequence=0;this.sentReports=0;this.itemStarted=false;this.started=false;this.terminal=false;}
  emit(type,fields){this.write(event(type,{sequence_number:this.sequence++,...fields}));}
  start(response){
    if(this.started)return;
    this.started=true;
    const {sessionId,reports,last_activity_at,heartbeat_count,...publicResponse}=response;
    const start={...publicResponse,status:'in_progress',output:[]};
    this.emit('response.created',{response:start});
    this.emit('response.in_progress',{response:start});
  }
  update(response){
    if(this.terminal)return true;
    this.start(response);
    const {sessionId,reports,last_activity_at,heartbeat_count,...publicResponse}=response;
    const item=publicResponse.output?.[0];
    if(item&&!this.itemStarted){
      this.emit('response.output_item.added',{output_index:0,item:{id:item.id,type:'message',status:'in_progress',role:'assistant',content:[]}});
      this.emit('response.content_part.added',{output_index:0,content_index:0,item_id:item.id,part:{type:'output_text',text:'',annotations:[]}});
      this.itemStarted=true;
    }
    // Every MCP text call is an independently reported SSE delta, even when
    // more than one report arrives between two Gateway polling intervals.
    const chunks=Array.isArray(reports)?reports:(item?[item.content[0].text]:[]);
    for(let i=this.sentReports;i<chunks.length;i++){
      this.emit('response.output_text.delta',{output_index:0,content_index:0,item_id:item.id,
        delta:(i?'\n':'')+chunks[i]});
      this.sentReports=i+1;
    }
    if(response.status==='completed'){
      if(item){
        this.emit('response.output_text.done',{output_index:0,content_index:0,item_id:item.id,text:item.content[0].text});
        this.emit('response.content_part.done',{output_index:0,content_index:0,item_id:item.id,part:item.content[0]});
        this.emit('response.output_item.done',{output_index:0,item});
      }
      this.emit('response.completed',{response:publicResponse});this.terminal=true;
    }else if(response.status==='failed'){
      this.emit('response.failed',{response:publicResponse});this.terminal=true;
    }
    return this.terminal;
  }
  fail(error,id){
    if(this.terminal)return;
    this.emit('response.failed',{response:{id,object:'response',status:'failed',error:{type:'transport_error',message:error.message}}});
    this.terminal=true;
  }
}
export function streamResponse(response){
  let data='';const writer=new ResponseSseWriter(chunk=>data+=chunk);
  writer.update(response);
  return data;
}
export function failureStream(error,id){return event('response.failed',{sequence_number:1,response:{id,object:'response',status:'failed',error:{type:'transport_error',message:error.message}}});}
export class ResponseEngine {
  constructor({store,transport,transports=null}){this.store=store;this.transports=transports??{chatgpt:transport};this.busy=new Set();}
  async run(body,{onStarted,codexThreadId=null}={}){
    const messages=assertInput(body);
    const model=canonicalModel(body.model);
    if(model==='z'&&messages.some(m=>m.images.length))throw Error('z supports text only; image attachments are unsupported');
    const transport=this.transports[model];
    if(!transport)throw Error('model transport unavailable: '+model);
    const condensed=compact(messages);
    const hint=body.metadata?.session_id??null;
    const declaredThread=body.metadata?.codex_thread_id??null;
    if(declaredThread&&codexThreadId&&declaredThread!==codexThreadId)
      throw Error('Codex Thread ID conflicts with request metadata');
    const owner=codexThreadId??declaredThread;
    if(owner&&(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(owner)))
      throw Error('invalid Codex Thread ID');
    let session=this.store.resolve(body.previous_response_id,hint,owner,model);
    if(!session)session=this.store.create(condensed,hint,owner,model);
    // Codex message item IDs are stable across retries, unlike message text.
    // A completed or pending exact-item replay must never re-submit the turn.
    const rawLatest=Array.isArray(body.input)?body.input.findLast(x=>x?.role==='user'):null;
    const latestUserId=typeof rawLatest?.id==='string'&&/^[A-Za-z0-9_-]{8,128}$/.test(rawLatest.id)?rawLatest.id:null;
    const sameItem=latestUserId&&latestUserId===session.lastUserItemId;
    if(sameItem&&session.lastResponseId){
      const previous=this.store.response(session.lastResponseId);
      if(previous?.status==='completed'){
        onStarted?.({...previous});return previous;
      }
      if(!body.stream&&previous&&['submitting','awaiting'].includes(session.status)){
        onStarted?.({...previous});return previous;
      }
    }
    if(this.busy.has(session.id)||['submitting','awaiting','uncertain'].includes(session.status))
      throw Error('session has an unconfirmed submission; manual reconciliation required');
    const responseId='resp_'+key();
    const response={id:responseId,object:'response',model:body.model,created_at:Math.floor(Date.now()/1000),status:'in_progress',output:[],sessionId:session.id,usage:null,metadata:body.metadata??null};
    this.store.putResponse(response);
    this.busy.add(session.id);
    session.status='submitting';session.lastInput=condensed;session.lastResponseId=responseId;session.lastUserItemId=latestUserId;this.store.putSession(session);
    if(onStarted)onStarted({...response});
    try{
      const latestUser=messages.findLast(message=>message.role==='user');
      if(!latestUser)throw Error('a new user message is required for model delivery');
      const files=model==='chatgpt'?materializeImages([latestUser],join(this.store.base,'attachments',session.id)):[];
      const input=[{role:'user',content:latestUser.text,images:files.map(file=>({file}))}];
      // Z.ai does not have Neo MCP/Events Bus; its Action verifies webpage SSE done.
      const {prompt,enforcement_context}=model==='z'?{prompt:latestUser.text,enforcement_context:''}:
        createTurnPrompt({responseId,messages:input});
      if(!transport.waitForResult)throw Error('model transport requires verified completion');
      if(!session.threadId){
        // Z.ai must first receive the provider-specific Neo MCP bootstrap,
        // with a newly issued one-hour access token, in a private first turn.
        // Persist its verified thread ID BEFORE sending the actual user task.
        // This protects against duplicate bootstrap after uncertain delivery.
        const receipt=model==='z'?await transport.bootstrapThread(responseId):
          await transport.newThread(prompt,enforcement_context,responseId);
        if(!receipt?.thread_id)throw Error('new-thread did not return a verified thread ID');
        if(model==='z'&&receipt.bootstrap_verified!==true)throw Error('Z.ai bootstrap was not verified');
        const live=this.store.session(session.id);
        live.threadId=receipt.thread_id;live.threadUrl=receipt.thread_url;
        live.projectId=receipt.project_id??null;
        if(model==='z')live.bootstrapVerifiedAt=Date.now();
        live.status=model==='z'?'submitting':
          (this.store.response(responseId)?.status==='completed'?'idle':'awaiting');
        this.store.putSession(live);
        if(model==='z'){
          await transport.newTurn(receipt.thread_id,prompt,[],responseId);
          live.status='awaiting';this.store.putSession(live);
        }
      }else{
        const live=this.store.session(session.id);
        live.status='awaiting';this.store.putSession(live);
        await transport.newTurn(session.threadId,prompt,[],responseId,session.projectId??null,enforcement_context);
      }
      // Text reports leave status=in_progress. Only an explicit reply.completed
      // event makes the waiter settle and allows this Turn to end.
      await transport.waitForResult(responseId,this.store);
      const completed=this.store.response(responseId);
      if(completed?.status!=='completed')throw Error('Turn is missing explicit completion');
      return completed;
    }catch(e){
      // Preserve every previously reported item; an error after partial output
      // must not overwrite the journal with the original empty response.
      const latest=this.store.response(responseId);
      if(latest?.status==='completed')return latest;
      if(latest?.status==='in_progress'){
        latest.status='failed';latest.error={type:'transport_error',message:e.message};
        this.store.putResponse(latest);
      }
      // Browser delivery may have succeeded despite a receipt failure.
      // Never retry a submitted turn automatically, even after process restart.
      const live=this.store.session(session.id);
      if(live?.lastResponseId===responseId){live.status='uncertain';this.store.putSession(live)}
      throw e;
    }finally{this.busy.delete(session.id);}
  }
}
