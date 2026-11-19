import {key,assertInput,isPrefix,materializeImages,compact,signature} from './input.mjs';
import {join} from 'node:path';
import {createTurnPrompt} from './prompt.mjs';
const event=(type,obj)=>`event: ${type}\ndata: ${JSON.stringify({type,...obj})}\n\n`;
export function streamResponse(response){
  let sequence_number=0;
  const evt=(type,data)=>event(type,{sequence_number:sequence_number++,...data});
  const start={...response,status:'in_progress',output:[]};let s=evt('response.created',{response:start})+evt('response.in_progress',{response:start});
  for(const [i,item] of response.output.entries()){
    s+=evt('response.output_item.added',{output_index:i,item:{id:item.id,type:'message',status:'in_progress',role:'assistant',content:[]}});
    s+=evt('response.content_part.added',{output_index:i,content_index:0,item_id:item.id,part:{type:'output_text',text:'',annotations:[]}});
    s+=evt('response.output_text.delta',{output_index:i,content_index:0,item_id:item.id,delta:item.content[0].text});
    s+=evt('response.output_text.done',{output_index:i,content_index:0,item_id:item.id,text:item.content[0].text});
    s+=evt('response.content_part.done',{output_index:i,content_index:0,item_id:item.id,part:item.content[0]});
    s+=evt('response.output_item.done',{output_index:i,item});
  }
  return s+evt('response.completed',{response});
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
      const files=materializeImages(requestMessages,join(this.store.base,'attachments',session.id));
      let imageIndex=0;
      const input=requestMessages.map(m=>({role:m.role,content:m.text,images:m.images.map(()=>({file:files[imageIndex++]}))}));
      const {prompt}=createTurnPrompt({responseId,messages:input});
      let text;
      if(!session.threadId){
        const receipt=await this.transport.newThread(prompt);
        if(!receipt?.thread_id)throw Error('new-thread did not return a verified thread ID');
        session.threadId=receipt.thread_id;session.threadUrl=receipt.thread_url;
        session.status='awaiting';this.store.putSession(session);
        text=this.transport.waitForResult?await this.transport.waitForResult(responseId,this.store):
          await this.transport.readAnswer(session.threadUrl);
      }else{
        session.status='awaiting';this.store.putSession(session);
        const receipt=await this.transport.newTurn(session.threadId,prompt,[],responseId);
        text=this.transport.waitForResult?await this.transport.waitForResult(responseId,this.store):receipt;
      }
      if(typeof text!=='string'||!text.trim())throw Error('empty assistant answer');
      const item={id:'msg_'+key(),type:'message',status:'completed',role:'assistant',content:[{type:'output_text',text,annotations:[]}]};
      response.status='completed';response.output=[item];this.store.putResponse(response);
      session.status='idle';
      const prior=(!isPrefix(condensed,session.history)&&(body.previous_response_id||hint))?session.history:[];
      session.history=[...prior,...condensed,{role:'assistant',text,images:[]}];this.store.putSession(session);
      return response;
    }catch(e){
      response.status='failed';response.error={type:'transport_error',message:e.message};this.store.putResponse(response);
      // Browser delivery may have succeeded despite a receipt failure.
      // Never retry a submitted turn automatically, even after process restart.
      session.status='uncertain';this.store.putSession(session);
      throw e;
    }finally{this.busy.delete(session.id);}
  }
}
