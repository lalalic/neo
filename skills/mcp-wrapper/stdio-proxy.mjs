/** Small transparent MCP stdio proxy. Wrap one named tools/call; no middleware registry. */
import {spawn} from 'node:child_process';
import readline from 'node:readline';
import {randomUUID} from 'node:crypto';

export function startStdioProxy({command,args=[],toolName,wrapCall,description,stdin=process.stdin,stdout=process.stdout}) {
  if(!command||typeof command!=='string'||!command.startsWith('/'))throw Error('MCP upstream command must be absolute');
  const child=spawn(command,args,{stdio:['pipe','pipe','inherit'],env:process.env});
  const pending=new Map();
  const send=message=>stdout.write(JSON.stringify(message)+'\n');
  const requestChild=message=>new Promise((resolve,reject)=>{
    const id=`neo-wrapper-${randomUUID()}`;
    pending.set(id,{resolve,reject});
    child.stdin.write(JSON.stringify({...message,id})+'\n',error=>{
      if(error){pending.delete(id);reject(error);}
    });
  });
  const upstream=readline.createInterface({input:child.stdout,crlfDelay:Infinity});
  upstream.on('line',line=>{
    let message;try{message=JSON.parse(line);}catch{process.stderr.write('Neo MCP wrapper: upstream emitted non-JSON stdout\n');return;}
    const item=pending.get(message.id);
    if(item){pending.delete(message.id);item.resolve(message);return;}
    if(message?.result?.tools&&Array.isArray(message.result.tools)&&description){
      for(const tool of message.result.tools){
        if(tool.name===toolName)tool.description=description;
      }
      send(message);
    }else stdout.write(line+'\n');
  });
  child.on('error',error=>{
    for(const entry of pending.values())entry.reject(error);pending.clear();
    process.stderr.write('Neo MCP wrapper upstream: '+error.message+'\n');
  });
  child.on('exit',(code,signal)=>{
    for(const entry of pending.values())entry.reject(Error('Upstream MCP exited'));
    pending.clear();
    if(stdin===process.stdin)process.exitCode=code|| (signal?1:0);
    incoming.close();
  });
  const incoming=readline.createInterface({input:stdin,crlfDelay:Infinity});
  incoming.on('line',line=>{
    let message;try{message=JSON.parse(line);}catch{child.stdin.write(line+'\n');return;}
    if(message?.method==='tools/call'&&message?.params?.name===toolName&&message.id===undefined){
      process.stderr.write('Neo MCP wrapper: ignoring uncorrelated preview call\n');return;
    }
    if(message?.method!=='tools/call'||message?.params?.name!==toolName){
      child.stdin.write(line+'\n');return;
    }
    void (async()=>{
      try{
        const result=await wrapCall(message,async forwarded=>{
          const response=await requestChild(forwarded);
          if(response.error)throw Error(response.error.message||'Upstream MCP call failed');
          return response.result;
        });
        send({jsonrpc:'2.0',id:message.id,result});
      }catch(error){
        send({jsonrpc:'2.0',id:message.id,result:{isError:true,
          content:[{type:'text',text:String(error?.message||error)}]}});
      }
    })();
  });
  incoming.on('close',()=>{if(!child.killed)child.stdin.end();});
  return child;
}
