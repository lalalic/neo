// Generic declarative transport routing; no application contract or executable adapter.
import {validateSubject,validatePublicEvent} from './envelope.mjs';
const token = value => typeof value==='string' && /^[A-Za-z0-9_-]+$/.test(value);
export function routing(config){
  const rules=config.routing??{routes:[],fallbackPrefix:'{configured}.generic'};
  if(!Array.isArray(rules.routes)||typeof rules.fallbackPrefix!=='string')throw Error('invalid transport routing configuration');
  const configured=validateSubject(config.subjectPrefix);
  const base=rules.trimSuffix&&configured.endsWith(rules.trimSuffix)?
    configured.slice(0,-rules.trimSuffix.length):configured;
  const expand=value=>validateSubject(value.replaceAll('{configured}',configured).replaceAll('{base}',base));
  const fallback=expand(rules.fallbackPrefix);
  const routes=rules.routes.map(rule=>{
    if(typeof rule?.sourcePrefix!=='string'||!rule.sourcePrefix||
       typeof rule.subjectPrefix!=='string'||!Array.isArray(rule.tokens)||
       rule.tokens.some(i=>!Number.isSafeInteger(i)||i<0)||
       typeof rule.appendType!=='boolean'||typeof rule.persist!=='boolean')throw Error('invalid transport route');
    return {...rule,prefix:expand(rule.subjectPrefix)};
  });
  if(new Set(routes.map(r=>r.sourcePrefix)).size!==routes.length||
     new Set([fallback,...routes.map(r=>r.prefix)]).size!==routes.length+1)
    throw Error('ambiguous transport routes');
  routes.sort((a,b)=>b.sourcePrefix.length-a.sourcePrefix.length);
  return {routes,fallback};
}
export function routeEvent(input,config){
  const {type,source,data}=validatePublicEvent(input);
  const {routes,fallback}=routing(config);
  const rule=routes.find(r=>source.startsWith(r.sourcePrefix));
  let subject;
  if(rule){
    const segments=source.split('/');
    const parts=rule.tokens.map(i=>segments[i]);
    if(parts.some(part=>!token(part)))throw Error('invalid routing token');
    subject=[rule.prefix,...parts,...(rule.appendType?[type]:[])].join('.');
  }else subject=fallback+'.'+Buffer.from(source,'utf8').toString('base64url')+'.'+type;
  return {subject:validateSubject(subject),event:{type,source:{id:source},data}};
}
export function recordingBindings(config){
  const {routes,fallback}=routing(config);
  const prefixes=[...new Set([fallback,...routes.filter(r=>r.persist).map(r=>r.prefix)])];
  return prefixes.filter(p=>!prefixes.some(other=>other!==p&&p.startsWith(other+'.'))).map(p=>p+'.>');
}
export function acceptsRecord(subject,event,config){
  const {routes,fallback}=routing(config);
  const candidates=[...routes,{prefix:fallback,persist:true}].filter(r=>subject.startsWith(r.prefix+'.')).sort((a,b)=>b.prefix.length-a.prefix.length);
  if(!candidates[0]?.persist)return false;
  // Canonical public envelopes can be checked against the declarative routing
  // table. Historical publisher-generated extensions remain opaque.
  const id=event?.source?.id;
  const canonical=Object.keys(event).every(k=>['type','source','data','version','event_id','timestamp'].includes(k));
  if(canonical||(typeof id==='string'&&routes.some(r=>id.startsWith(r.sourcePrefix)))){
    try{return routeEvent({type:event.type,source:id,data:event.data??{}},config).subject===subject}catch{return false}
  }
  // Historical producer-enriched events may have no routable source.
  // They are accepted only on an explicitly configured persisted route,
  // never on the canonical fallback namespace.
  return candidates[0].prefix!==fallback;
}
