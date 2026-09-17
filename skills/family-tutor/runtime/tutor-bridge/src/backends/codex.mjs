import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

export function parseJsonl(text){
  let threadId=null, answer='', outputs=[];
  for(const line of text.split(/\r?\n/)){
    if(!line.trim()) continue;
    let event; try{event=JSON.parse(line)}catch{continue}
    if(event.type==='thread.started' && event.thread_id) threadId=event.thread_id;
    const item=event.item||event;
    if(item.type==='agent_message' || item.type==='assistant_message') answer+=item.text||item.message||'';
    if(item.type==='file' && item.path) outputs.push({name:path.basename(item.path),path:item.path});
  }
  return {threadId,text:answer.trim(),outputs};
}

function run(args,prompt,cwd,timeoutMs){
  return new Promise((resolve,reject)=>{
    const child=spawn('codex',args,{cwd,stdio:['pipe','pipe','pipe']});
    let stdout='',stderr=''; const timer=setTimeout(()=>child.kill('SIGTERM'),timeoutMs);
    child.stdout.on('data',b=>stdout+=b); child.stderr.on('data',b=>stderr+=b);
    child.on('error',reject); child.on('close',code=>{clearTimeout(timer); if(code) reject(new Error(`codex exited ${code}: ${stderr.trim()||stdout.trim()}`)); else resolve(parseJsonl(stdout));});
    child.stdin.end(prompt);
  });
}

async function downloadImages(attachments){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'family-tutor-'));
  const files=[];
  for(const [i,a] of attachments.entries()){
    const type=String(a.mimeType||'').toLowerCase();
    if(!type.startsWith('image/')) continue;
    const response=await fetch(a.url,{signal:AbortSignal.timeout(30_000)});
    if(!response.ok) throw new Error(`attachment download failed (${response.status})`);
    const file=path.join(dir,`${i+1}-${path.basename(a.name||'image').replace(/[^a-z0-9._-]/gi,'_')}`);
    fs.writeFileSync(file,Buffer.from(await response.arrayBuffer())); files.push(file);
  }
  return {dir,files};
}

export class CodexBackend{
  constructor(config,{instanceDir}){this.config=config; this.instanceDir=instanceDir;}
  stateFile(childId){return path.join(this.instanceDir,childId,'.codex-thread.json');}
  memoryFile(childId){return path.join(this.instanceDir,childId,'AGENTS.md');}
  readThread(childId){try{return JSON.parse(fs.readFileSync(this.stateFile(childId),'utf8')).threadId||null}catch{return null}}
  writeThread(childId,threadId){const file=this.stateFile(childId); fs.mkdirSync(path.dirname(file),{recursive:true}); const tmp=`${file}.tmp`; fs.writeFileSync(tmp,JSON.stringify({threadId},null,2)+'\n',{mode:0o600}); fs.renameSync(tmp,file);}
  async turn({childId,prompt,attachments=[]}){
    const memoryFile=this.memoryFile(childId);
    const memory=fs.existsSync(memoryFile)?fs.readFileSync(memoryFile,'utf8'):'';
    const full=`You are the private tutor for child ${childId}. Use the durable learner context below. Never reveal runtime control markers.\n\n<DURABLE_LEARNER_CONTEXT>\n${memory}\n</DURABLE_LEARNER_CONTEXT>\n\n${prompt}`;
    const thread=this.readThread(childId);
    const args=['exec','--json','--sandbox','read-only','--skip-git-repo-check','-C',this.instanceDir];
    if(this.config.model) args.push('--model',this.config.model);
    if(thread) args.push('resume',thread);
    let downloaded={dir:null,files:[]};
    try{
      downloaded=await downloadImages(attachments);
      for(const file of downloaded.files) args.push('--image',file);
      const result=await run(args,full,this.instanceDir,(this.config.maxRuntimeSeconds||600)*1000+30_000);
      if(result.threadId) this.writeThread(childId,result.threadId);
      if(!result.text) throw new Error('Codex returned no assistant text');
      return result;
    }finally{if(downloaded.dir) fs.rmSync(downloaded.dir,{recursive:true,force:true});}
  }
  async newThread({childId}){const file=this.stateFile(childId); try{fs.unlinkSync(file)}catch(error){if(error.code!=='ENOENT') throw error;}}
}
