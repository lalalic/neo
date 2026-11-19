/** Generic reply events use the EXISTING events.publish MCP tool.
 * No channel-specific tool, job ID, or chat_report routing is needed.
 * source: reply/<channel>/<request_id> is the routing identity.
 */
export const REPLY_TYPES = new Set(['reply.text','reply.heartbeat','reply.completed','reply.failed']);
const CHANNEL = /^[a-z][a-z0-9-]{0,31}$/;
const SOURCE = /^reply\/([a-z][a-z0-9-]{0,31})\/([A-Za-z0-9_-]{8,100})$/;
export function parseReplySource(source) {
  const match=typeof source==='string' ? SOURCE.exec(source) : null;
  if(!match||!CHANNEL.test(match[1]))throw Error('invalid reply source; use reply/<channel>/<request_id>');
  return {channel:match[1],request_id:match[2]};
}
export function validateReplyEvent({type,source,data={}}) {
  if(!REPLY_TYPES.has(type))throw Error('unsupported reply event type');
  const {channel,request_id}=parseReplySource(source);
  if(!data||typeof data!=='object'||Array.isArray(data))throw Error('reply data must be an object');
  const allowed=type==='reply.text'?['text','seq']:
    type==='reply.failed'?['error']:[];
  if(Object.keys(data).some(key=>!allowed.includes(key)))throw Error('unsupported reply data field');
  if(type==='reply.text'){
    if(typeof data.text!=='string'||!data.text.trim()||data.text.length>100_000)throw Error('reply.text needs non-empty bounded text');
    if(!Number.isSafeInteger(data.seq)||data.seq<1)throw Error('reply.text seq must be a positive integer starting at 1');
  }else if(type==='reply.failed'&&
    (typeof data.error!=='string'||!data.error.trim()||data.error.length>1000))throw Error('reply.failed needs a bounded error');
  return {kind:'reply',type,source:{id:source},channel,request_id,data};
}
export function replySubject(config,channel,request_id) {
  parseReplySource(`reply/${channel}/${request_id}`);
  const prefix=config.subjectPrefix.endsWith('.job')
    ? config.subjectPrefix.slice(0,-4)+'.reply'
    : config.subjectPrefix+'.reply';
  return `${prefix}.${channel}.${request_id}`;
}
export function replyChannelSubject(config,channel){
  if(!CHANNEL.test(channel))throw Error('invalid reply channel');
  return replySubject(config,channel,'request-id').replace(/\.request-id$/,'.>');
}
export function expandReplyEvent(input){
  const validated=validateReplyEvent(input);
  return validated;
}
