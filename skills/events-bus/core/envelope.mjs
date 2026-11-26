import crypto from 'node:crypto';
export const safeType=value=>typeof value==='string'&&value.length<=128&&/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(value);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export function validatePublicEvent(input) {
  if(!object(input)||Object.keys(input).some(k=>!['type','source','data'].includes(k)))throw Error('event requires type, source and data only');
  const {type,source,data={}}=input;
  if(!safeType(type))throw Error('invalid event type');
  if(typeof source!=='string'||!source.trim()||source.length>2048||/[\x00-\x1f\x7f]/.test(source))throw Error('invalid event source');
  if(!object(data))throw Error('event data must be an object');
  return {type,source,data};
}
export function validateSubject(subject) {
  if(typeof subject!=='string'||subject.length>4096||!subject.split('.').every(t=>t&&/^[^\s.*>\x00-\x1f\x7f]+$/.test(t)))throw Error('invalid event subject');
  return subject;
}
export function transportEnvelope(input) {
  if(!object(input)||!safeType(input.type)||!object(input.data))throw Error('invalid transport envelope');
  if(!object(input.source))throw Error('invalid transport source');
  if(input.event_id!==undefined&&(typeof input.event_id!=='string'||!input.event_id.trim()||input.event_id.length>4096))throw Error('invalid event ID');
  if(input.version!==undefined&&input.version!==1)throw Error('unsupported envelope version');
  return {...input,version:1,event_id:input.event_id??crypto.randomUUID(),timestamp:new Date().toISOString()};
}
