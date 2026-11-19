import {connect} from '@nats-io/transport-node';
import {resolveRuntimeConfig} from './config.mjs';
import {replyChannelSubject,replySubject,validateReplyEvent} from './reply-contract.mjs';

/** Register a push-based, channel-specific event listener BEFORE dispatching
 * requests. The owner handles idempotency and terminal state. NATS subscriptions
 * are live, not durable queues; owner must have a timeout/reconciliation path.
 */
export class ReplyEventListener {
  constructor({channel,onEvent,config=resolveRuntimeConfig(),connectNats=connect,onError=()=>{}}){
    if(typeof onEvent!=='function')throw Error('onEvent callback required');
    this.channel=channel;this.onEvent=onEvent;this.config=config;this.connectNats=connectNats;
    this.onError=onError;this.nc=null;this.sub=null;this.running=false;this.task=null;
    replyChannelSubject(config,channel);
  }
  async start(){
    if(this.running)return this;
    const nc=await this.connectNats({servers:this.config.natsUrl,name:`neo-reply-${this.channel}`});
    const sub=nc.subscribe(replyChannelSubject(this.config,this.channel));
    try{await nc.flush()}catch(error){sub.unsubscribe();await nc.close();throw error}
    this.nc=nc;this.sub=sub;this.running=true;
    this.task=(async()=>{
      const decoder=new TextDecoder();
      try{
        for await(const message of sub){
          try{
            const raw=JSON.parse(decoder.decode(message.data));
            const event=validateReplyEvent({type:raw.type,source:raw.source?.id,data:raw.data});
            if(event.channel!==this.channel||message.subject!==replySubject(this.config,event.channel,event.request_id))continue;
            await this.onEvent(event);
          }catch(e){this.onError(e)}
        }
      }catch(e){if(this.running)this.onError(e)}
    })();
    return this;
  }
  async close(){
    if(!this.running)return;
    this.running=false;
    this.sub?.unsubscribe();
    await this.nc?.close();
    await this.task;
    this.nc=null;this.sub=null;this.task=null;
  }
}
export function listenReplyEvents(options){return new ReplyEventListener(options)}
