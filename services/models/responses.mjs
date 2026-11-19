import {key,assertInput,isPrefix,materializeImages,compact,signature} from './input.mjs';
import {join} from 'node:path';
import {createTurnPrompt} from './prompt.mjs';
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
  constructor({store,transport}){this.store=store;this.transport=transport;this.busy=new Set();}
  async run(body,{onStarted}={}){
    const messages=assertInput(body);
    const condensed=compact(messages);
    const hint=body.metadata?.session_id??null;
    let session=this.store.resolve(condensed,body.previous_response_id,hint);
    if(!session)session=this.store.create(condensed,hint);
    if(this.busy.has(session.id)||['submitting','awaiting','uncertain'].includes(session.status)){
      // A duplicate nonstream POST gets the same pending response ID, never a
      // second ChatGPT submission. Streaming retries cannot safely replay SSE.
      if(!body.stream && ['submitting','awaiting'].includes(session.status)&&
         signature(condensed)===signature(session.lastInput)&&session.lastResponseId){
        const pending=this.store.response(session.lastResponseId);
        if(pending){onStarted?.({...pending});return pending;}
      }
      throw Error('session has an unconfirmed submission; manual reconciliation required');
    }
    let delta;
    if(body.previous_response_id){
      delta=isPrefix(condensed,session.history)?messages.slice(session.history.length):messages;
    }
    else if(isPrefix(condensed,session.history))delta=messages.slice(session.history.length);
    else if(isPrefix(session.history,condensed))delta=[]; // replay of earlier history
    else if(hint&&session.clientSessionId===hint)delta=messages; // explicit session binding
    else throw Error('request does not extend the prior conversation history');
    if(!delta.length && session.lastResponseId){
      const previous=this.store.response(session.lastResponseId);
      if(previous?.status==='completed'){onStarted?.({...previous});return previous;}
      throw Error('previous response still pending');
    }
    if(!delta.length && session.status!=='new')throw Error('empty subsequent turn');
    const responseId='resp_'+key();
    const response={id:responseId,object:'response',model:'neo',created_at:Math.floor(Date.now()/1000),status:'in_progress',output:[],sessionId:session.id,usage:null,metadata:body.metadata??null};
    this.store.putResponse(response);
    this.busy.add(session.id);
    session.status='submitting';session.lastInput=condensed;session.lastResponseId=responseId;this.store.putSession(session);
    if(onStarted)onStarted({...response});
    try{
      const requestMessages=delta.length?delta:messages;
      const latestUser=requestMessages.findLast(message=>message.role==='user');
      if(!latestUser)throw Error('a new user message is required for ChatGPT delivery');
      const files=materializeImages([latestUser],join(this.store.base,'attachments',session.id));
      const input=[{role:'user',content:latestUser.text,images:files.map(file=>({file}))}];
      const {prompt}=createTurnPrompt({responseId,messages:input});
      if(!this.transport.waitForResult)throw Error('model transport requires explicit chat_report completion');
      if(!session.threadId){
        const receipt=await this.transport.newThread(prompt);
        if(!receipt?.thread_id)throw Error('new-thread did not return a verified thread ID');
        const live=this.store.session(session.id);
        live.threadId=receipt.thread_id;live.threadUrl=receipt.thread_url;
        live.projectId=receipt.project_id??null;
        live.status=this.store.response(responseId)?.status==='completed'?'idle':'awaiting';
        this.store.putSession(live);
      }else{
        const live=this.store.session(session.id);
        live.status='awaiting';this.store.putSession(live);
        await this.transport.newTurn(session.threadId,prompt,[],responseId,session.projectId??null);
      }
      // Text reports leave status=in_progress. Only a distinct completed:true
      // report makes the waiter settle and allows this Turn to end.
      await this.transport.waitForResult(responseId,this.store);
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
