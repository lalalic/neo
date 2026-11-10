// Neo GPU container runtime. Runs the image's declared command once, using a
// narrow HTTP media contract. Network authentication belongs to the provider:
// HF Jobs private proxy, or Vast.ai through an SSH loopback tunnel.
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {createWriteStream, createReadStream, existsSync, mkdirSync, lstatSync, statSync} from 'node:fs';
import {rename, unlink} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {randomUUID} from 'node:crypto';

const input = process.env.NEO_GPU_INPUT_DIR || '/neo/input';
const output = process.env.NEO_GPU_OUTPUT_DIR || '/neo/output';
const port = Number(process.env.NEO_GPU_PORT || 8000);
const sizeLimit = 64 * 1024 * 1024;
const state = {phase:'idle', exitCode:null, log:''};
mkdirSync(input,{recursive:true,mode:0o700});
mkdirSync(output,{recursive:true,mode:0o700});
const validName = name => /^[a-zA-Z][a-zA-Z0-9_-]{0,63}(?:\.[a-zA-Z0-9]{1,10})?$/.test(name);
const respond = (res, code, value) => {
  const data = Buffer.from(JSON.stringify(value));
  res.writeHead(code,{'Content-Type':'application/json','Content-Length':data.length,'Cache-Control':'no-store'});
  res.end(data);
};
const command = (() => {
  try {
    const value = JSON.parse(process.env.NEO_GPU_CMD_JSON || 'null');
    if (Array.isArray(value) && value.every(s=>typeof s==='string') && value.length && value.every(s=>!s.includes('\0'))) return value;
  } catch {}
  return process.argv.slice(2);
})();

async function upload(req,res,name) {
  if (!validName(name)) return respond(res,400,{error:'invalid_name'});
  if (state.phase !== 'idle') return respond(res,409,{error:'already_started'});
  const declared = Number(req.headers['content-length']);
  if (!Number.isSafeInteger(declared) || declared<1 || declared>sizeLimit) return respond(res,413,{error:'invalid_content_length'});
  const dest = join(input,name),tmp = dest+'.'+randomUUID()+'.tmp';
  let count=0;
  try {
    const stream=createWriteStream(tmp,{flags:'wx',mode:0o600});
    for await (const chunk of req) {
      count+=chunk.length;
      if (count>declared) throw Error('oversized_upload');
      if (!stream.write(chunk)) await new Promise((okay,fail)=>{stream.once('drain',okay);stream.once('error',fail);});
    }
    await new Promise((okay,fail)=>stream.end(e=>e?fail(e):okay()));
    if (count!==declared) throw Error('short_upload');
    await rename(tmp,dest);
    respond(res,200,{bytes:count});
  } catch {
    await unlink(tmp).catch(()=>{});
    respond(res,400,{error:'upload_incomplete'});
  }
}

function run() {
  if (state.phase!=='idle') return false;
  if (!command.length || !command[0]) {state.phase='failed';state.log='image has no executable CMD or ENTRYPOINT';return false;}
  state.phase='running';
  const worker=spawn(command[0],command.slice(1),{
    cwd:process.cwd(),stdio:['ignore','pipe','pipe'],shell:false,
    env:{...process.env,NEO_GPU_INPUT_DIR:input,NEO_GPU_OUTPUT_DIR:output}
  });
  const record=part=>{state.log=(state.log+part.toString('utf8')).slice(-2400);};
  worker.stdout.on('data',record);worker.stderr.on('data',record);
  worker.on('error',err=>{state.phase='failed';state.log=(state.log+'\n'+err.message).slice(-2400);});
  worker.on('close',code=>{state.exitCode=code;state.phase=code===0?'completed':'failed';});
  return true;
}

const server=createServer(async(req,res)=>{
  try {
    const path=new URL(req.url,'http://localhost').pathname;
    if (req.method==='GET' && path==='/health') return respond(res,200,{ok:true,service:'neo-gpu-v1'});
    if (req.method==='GET' && path==='/status') return respond(res,200,state);
    const inputMatch=/^\/inputs\/([^/]+)$/.exec(path);
    if (req.method==='POST' && inputMatch) return await upload(req,res,inputMatch[1]);
    if (req.method==='POST' && path==='/start') {
      if (state.phase!=='idle') return respond(res,409,{error:'already_started'});
      return respond(res,run()?202:422,{phase:state.phase});
    }
    const outputMatch=/^\/outputs\/([^/]+)$/.exec(path);
    if (req.method==='GET' && outputMatch) {
      const name=outputMatch[1];
      if (!validName(name)) return respond(res,400,{error:'invalid_name'});
      if (state.phase!=='completed') return respond(res,409,{error:'not_completed'});
      const file=resolve(output,name);
      if (!file.startsWith(resolve(output)+'/')) return respond(res,400,{error:'invalid_name'});
      try {if (!lstatSync(file).isFile()) return respond(res,404,{error:'missing_output'});} catch {return respond(res,404,{error:'missing_output'});}
      const bytes=statSync(file).size;
      if (bytes>2*1024*1024*1024) return respond(res,413,{error:'output_too_large'});
      res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':bytes,'Cache-Control':'no-store'});
      return createReadStream(file).pipe(res);
    }
    respond(res,404,{error:'not_found'});
  } catch (e) {if (!res.headersSent) respond(res,500,{error:'runtime_error'});else res.destroy();}
});
server.requestTimeout=120000;
server.listen(port,'0.0.0.0',()=>console.log('NEO_GPU_SERVICE_READY port='+port));
