#!/usr/bin/env node
/** One generic MCP reply tool for ChatGPT-backed Neo model requests.
 * Distinct from Neo Mobile's mcp.chat-gateway chat_report.
 */
import readline from 'node:readline';
import {ModelStore} from './store.mjs';
import {reportText,reportHeartbeat,reportComplete,reportFailed} from './report.mjs';

export const TOOL={
  name:'chat_report',
  description:'Neo API reporting tool. heartbeat:true acknowledges liveness without output or completion. text sends one segment and never completes. After all text segments, a separate completed:true is required to finish the Turn and SSE. error is terminal. Ordinary ChatGPT replies are not delivered. This is NOT the Neo Mobile gateway.',
  inputSchema:{
    type:'object',additionalProperties:false,required:['response_id'],
    properties:{
      response_id:{type:'string',pattern:'^resp_[0-9a-f]{40}$',description:'The response_id in the current Neo model request.'},
      text:{type:'string',minLength:1,description:'One report; may be called multiple times per response_id. Does not complete the Turn.'},
      heartbeat:{type:'boolean',const:true,description:'Liveness acknowledgment. Refreshes the request inactivity deadline; not answer text and never completes the Turn.'},
      completed:{type:'boolean',const:true,description:'Explicit final completion message, after all text reports. Causes response.completed and closes SSE.'},
      error:{type:'string',minLength:1,maxLength:500,description:'An actual reason this request cannot be completed.'},
    },
  },
};
export function invokeReport(store,args){
  if(!args||typeof args!=='object'||Array.isArray(args))throw Error('tool arguments must be an object');
  const {response_id,text,heartbeat,completed,error}=args;
  if(Object.keys(args).some(k=>!['response_id','text','heartbeat','completed','error'].includes(k)))throw Error('unsupported tool argument');
  if(typeof response_id!=='string'||!/^resp_[a-f0-9]{40}$/.test(response_id))throw Error('invalid response_id');
  if([text,heartbeat,completed,error].filter(x=>x!==undefined).length!==1)throw Error('provide exactly one of text, heartbeat:true, completed:true or error');
  if(heartbeat!==undefined&&heartbeat!==true)throw Error('heartbeat must be true');
  if(completed!==undefined&&completed!==true)throw Error('completed must be true');
  if(text!==undefined&&(typeof text!=='string'||!text.trim()))throw Error('text must be non-empty');
  const result=text!==undefined?reportText(store,response_id,text):
    heartbeat===true?reportHeartbeat(store,response_id):
    completed===true?reportComplete(store,response_id):reportFailed(store,response_id,error);
  return {response_id,status:result.status,report_count:result.reports?.length??result.output?.length??0,heartbeat_count:result.heartbeat_count??0,ok:true};
}
const send=(id,payload)=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,...payload})+'\n');
const toolResult=(value,isError=false)=>({content:[{type:'text',text:typeof value==='string'?value:JSON.stringify(value)}],isError});
export function handleMcp(message,store){
  const {id,method,params={}}=message;
  if(id===undefined)return null;
  if(method==='initialize')return {id,result:{protocolVersion:'2025-06-18',capabilities:{tools:{listChanged:false}},serverInfo:{name:'neo-models',version:'1.0.0'}}};
  if(method==='ping')return {id,result:{}};
  if(method==='tools/list')return {id,result:{tools:[TOOL]}};
  if(method==='resources/list')return {id,result:{resources:[]}};
  if(method==='tools/call'){
    if(params.name!==TOOL.name)return {id,result:toolResult('Unknown model reporting tool',true)};
    try{return {id,result:toolResult(invokeReport(store,params.arguments??{}))}}
    catch(e){return {id,result:toolResult(e.message,true)}}
  }
  return {id,error:{code:-32601,message:'Method not found'}};
}
if(process.argv[1]&&new URL(`file://${process.argv[1]}`).pathname===new URL(import.meta.url).pathname){
  const store=new ModelStore();
  const rl=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
  rl.on('line',line=>{
    let item;try{item=JSON.parse(line)}catch{return}
    const result=handleMcp(item,store);
    if(result)send(result.id,result.error?{error:result.error}:{result:result.result});
  });
}
