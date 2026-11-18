#!/usr/bin/env node
/** Model Thread -> generic Neo model API completion receipt.
 * This file is intentionally independent of any Agent or Neo Project.
 */
import {readFileSync,realpathSync,lstatSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ModelStore} from './store.mjs';
import {key,isPrefix} from './input.mjs';

const validId=id=>typeof id==='string'&&/^resp_[0-9a-f]{40}$/.test(id);
function mustResponse(store,id){
  if(!validId(id))throw Error('invalid response ID');
  const response=store.response(id);
  if(!response)throw Error('unknown response ID');
  return response;
}
export function reportCompleted(store,id,outputFile){
  const response=mustResponse(store,id);
  const expected=join(store.base,'requests',id+'.output.json');
  if(resolve(outputFile)!==expected||realpathSync(outputFile)!==realpathSync(expected)||!lstatSync(expected).isFile())
    throw Error('output must be the exact request output file');
  const contents=readFileSync(expected);
  if(contents.length<2||contents.length>4*1024*1024)throw Error('output file size invalid');
  const data=JSON.parse(contents.toString('utf8'));
  if(!data||!Object.prototype.hasOwnProperty.call(data,'output')||data.output===null)throw Error('output field required');
  const text=typeof data.output==='string'?data.output:JSON.stringify(data.output);
  if(!text.trim())throw Error('empty output');
  if(response.status==='completed'){
    if(response.output?.[0]?.content?.[0]?.text!==text)throw Error('conflicting completed output');
    return response;
  }
  if(response.status!=='in_progress')throw Error('response is already terminal');
  response.output=[{id:'msg_'+key(),type:'message',status:'completed',role:'assistant',content:[{type:'output_text',text,annotations:[]}]}];
  response.status='completed';
  store.putResponse(response);
  const session=store.session(response.sessionId);
  if(session?.lastResponseId===id){
    const incoming=session.lastInput;
    const prior=isPrefix(incoming,session.history)?[]:session.history;
    session.history=[...prior,...incoming,{role:'assistant',text,images:[]}];
    session.status='idle';store.putSession(session);
  }
  return response;
}
export function reportFailed(store,id,reason){
  const response=mustResponse(store,id);
  if(response.status==='completed')throw Error('response already completed');
  if(response.status==='failed')return response;
  if(typeof reason!=='string'||!reason.trim())throw Error('actual failure reason required');
  response.status='failed';response.error={type:'model_execution_failed',message:reason.slice(0,500)};
  store.putResponse(response);
  const session=store.session(response.sessionId);
  if(session?.lastResponseId===id){session.status='uncertain';store.putSession(session)}
  return response;
}
export function reportProgress(store,id,phase,message){
  const response=mustResponse(store,id);
  if(response.status!=='in_progress')throw Error('cannot update terminal response');
  if(!/^[a-z][a-z0-9_-]{0,45}$/.test(phase)||typeof message!=='string'||!message.trim())throw Error('invalid progress');
  response.progress={phase,message:message.slice(0,500)};
  store.putResponse(response);
  return response;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const [type,id,...args]=process.argv.slice(2),store=new ModelStore();
    const response=type==='completed'&&args.length===1?reportCompleted(store,id,args[0]):
      type==='failed'&&args.length===1?reportFailed(store,id,args[0]):
      type==='progress'&&args.length===2?reportProgress(store,id,args[0],args[1]):null;
    if(!response)throw Error('usage: report.mjs completed ID FILE | failed ID REASON | progress ID PHASE MESSAGE');
    console.log(JSON.stringify({ok:true,response_id:id,status:response.status}));
  }catch(e){console.error(e.message);process.exitCode=2}
}
