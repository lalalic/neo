import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

async function callProvider(messages){
  const directory=mkdtempSync(join(tmpdir(),'neo-apns-provider-test-'));
  const target=fileURLToPath(new URL('./mcp.mjs',import.meta.url));
  const child=spawn(process.execPath,[target],{stdio:['pipe','pipe','pipe'],
    env:{...process.env,NEO_APNS_HOME:directory}});
  try{
    return await new Promise((resolve,reject)=>{
      let stream='',errors='';const found=[];
      const timer=setTimeout(()=>{child.kill();reject(Error('APNs MCP timeout: '+errors))},6000);
      child.on('error',error=>{clearTimeout(timer);reject(error)});
      child.stderr.on('data',buf=>{errors+=buf.toString()});
      child.stdout.on('data',buf=>{
        stream+=buf.toString();let i;
        while((i=stream.indexOf('\n'))>=0){
          const line=stream.slice(0,i);stream=stream.slice(i+1);
          if(!line)continue;
          const reply=JSON.parse(line);found.push(reply);
          if(found.length===messages.length){clearTimeout(timer);resolve(found)}
        }
      });
      child.stdin.write(messages.map(m=>JSON.stringify(m)).join('\n')+'\n');
    });
  }finally{child.kill();rmSync(directory,{recursive:true,force:true})}
}
test('MCP only supports mobile register/pending/complete/status and never notify',async()=>{
  const request=(id,method,params={})=>({jsonrpc:'2.0',id,method,params});
  const results=await callProvider([
    request(1,'initialize',{protocolVersion:'2025-06-18'}),
    request(2,'tools/list'),
    request(3,'tools/call',{name:'review.push.notify',arguments:{}}),
    request(4,'tools/call',{name:'review.push.pending',arguments:{}})
  ]);
  assert.equal(results[0].result.serverInfo.name,'neox-apns');
  assert.deepEqual(results[1].result.tools.map(x=>x.name).sort(),[
    'review.push.complete','review.push.pending','review.push.register','review.push.status']);
  assert.equal(results[2].result.isError,true);
  assert.equal(results[3].result.structuredContent.requests.length,0);
});
