import {listenReplyEvents} from '../../skills/events-bus/core/reply-listener.mjs';
import {reportComplete,reportFailed,reportHeartbeat,reportText} from './report.mjs';

/** Model-specific consumer of the generic reply event contract.
 * Never sends to Neo Mobile and never invents terminal completion.
 */
export function applyModelReplyEvent(store,event){
  if(event.channel!=='models'||!/^resp_[a-f0-9]{40}$/.test(event.request_id))throw Error('invalid model reply channel or response_id');
  const id=event.request_id;
  const response=store.response(id);
  if(!response)return {ignored:true}; // unrelated/expired request
  if(event.type==='reply.text'){
    const reports=response.reports??[];
    const expected=reports.length+1;
    if(event.data.seq<expected){
      if(reports[event.data.seq-1]===event.data.text)return {duplicate:true};
      throw Error('conflicting model reply sequence');
    }
    if(event.data.seq!==expected)throw Error('out-of-order model reply sequence');
    return reportText(store,id,event.data.text);
  }
  if(event.type==='reply.heartbeat')return reportHeartbeat(store,id);
  if(event.type==='reply.completed')return reportComplete(store,id);
  if(event.type==='reply.failed')return reportFailed(store,id,event.data.error);
  throw Error('unsupported model reply event type');
}
export function createModelReplyListener(store,options={}){
  return listenReplyEvents({
    ...options,channel:'models',
    onEvent:event=>applyModelReplyEvent(store,event),
    onError:options.onError??(error=>process.stderr.write(`[model-reply-events] ${error.message}\n`)),
  });
}
