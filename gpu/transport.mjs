import {readFileSync,writeFileSync,openSync,closeSync,unlinkSync,statSync,renameSync,writeSync} from 'node:fs';
import {dirname,basename,resolve} from 'node:path';
import {GpuError,pause} from './common.mjs';
const maxInput=64*1024*1024,maxOutput=2*1024*1024*1024;
export function bindings(raw,kind){
  return (raw||[]).map(item=>{
    const eq=item.indexOf('=');
    const name=eq<0?basename(item):item.slice(0,eq);
    const file=resolve(eq<0?item:item.slice(eq+1));
    if(!/^[a-zA-Z][a-zA-Z\d_-]{0,63}(?:\.[a-zA-Z0-9]{1,10})?$/.test(name))throw new GpuError(`Invalid ${kind} name ${name}`);
    if(kind==='input'){
      const stat=statSync(file,{throwIfNoEntry:false});
      if(!stat?.isFile()||stat.size<1||stat.size>maxInput)throw new GpuError(`Input must be a 1..64MiB local file: ${file}`);
    }else{
      const parent=statSync(dirname(file),{throwIfNoEntry:false});
      if(!parent?.isDirectory())throw new GpuError(`Output directory missing: ${dirname(file)}`);
      if(statSync(file,{throwIfNoEntry:false}))throw new GpuError(`Refusing to overwrite: ${file}`);
    }
    return {name,file};
  });
}
export function hubToken(){
  if(process.env.HF_TOKEN)return process.env.HF_TOKEN;
  const home=process.env.HF_HOME || `${process.env.HOME}/.cache/huggingface`;
  try{return readFileSync(`${home}/token`,'utf8').trim();}
  catch{throw new GpuError('Hugging Face token not configured on this host');}
}
function timeout(ms){return AbortSignal.timeout(ms);}
export function proxy(job){
  const root=`https://${job}--8000.hf.jobs`;
  const token=hubToken();
  return async(path,opts={})=>{
    const url=root+path;
    const req={...opts,headers:{...(opts.headers||{}),Authorization:`Bearer ${token}`},signal:timeout(opts.timeout||20000)};
    const response=await fetch(url,req);
    if(!response.ok)throw new GpuError(`GPU service ${path} HTTP ${response.status}`);
    return response;
  };
}
export function localProxy(port){
  const root=`http://127.0.0.1:${port}`;
  return async(path,opts={})=>{
    const response=await fetch(root+path,{...opts,signal:timeout(opts.timeout||20000)});
    if(!response.ok)throw new GpuError(`GPU service ${path} HTTP ${response.status}`);
    return response;
  };
}
export async function runService(request, inputs, outputs,deadline){
  let ready=false;
  while(Date.now()<Math.min(deadline-45000,Date.now()+420000)){
    try {const data=await (await request('/health',{timeout:8000})).json();
      if(data.ok===true&&data.service==='neo-gpu-v1'){ready=true;break;}
    }catch{}
    await pause(4000);
  }
  if(!ready)throw new GpuError('GPU image did not expose the Neo GPU v1 service');
  console.log(JSON.stringify({phase:'gpu_service_ready'}));
  for(const {name,file} of inputs){
    const data=readFileSync(file);
    const res=await request(`/inputs/${encodeURIComponent(name)}`,{method:'POST',body:data,headers:{'Content-Type':'application/octet-stream'},timeout:90000});
    const saved=await res.json();if(saved.bytes!==data.length)throw new GpuError('Incomplete GPU media upload');
  }
  console.log(JSON.stringify({phase:'gpu_inputs_uploaded',count:inputs.length}));
  await request('/start',{method:'POST',body:'{}',headers:{'Content-Type':'application/json'}});
  let done=false;
  while(Date.now()<deadline-45000){
    const data=await(await request('/status')).json();
    if(data.phase==='completed'){done=true;break;}
    if(data.phase==='failed')throw new GpuError(`GPU service failed: ${String(data.log||'').slice(-500)}`);
    if(data.phase!=='running')throw new GpuError(`GPU service invalid phase ${data.phase}`);
    await pause(5000);
  }
  if(!done)throw new GpuError('GPU service timed out');
  const results=[];
  for(const {name,file} of outputs){
    const res=await request(`/outputs/${encodeURIComponent(name)}`,{timeout:90000});
    const length=Number(res.headers.get('content-length'));
    if(!Number.isSafeInteger(length)||length<1||length>maxOutput)throw new GpuError('GPU output size invalid');
    const partial=file+'.neo-gpu-part';
    const fd=openSync(partial,'wx',0o600);
    try{
      let received=0;
      for await(const chunk of res.body){
        received+=chunk.byteLength;
        if(received>length)throw new GpuError('GPU output exceeded declared size');
        writeSync(fd,Buffer.from(chunk));
      }
      if(received!==length)throw new GpuError('GPU output download truncated');
      closeSync(fd);
      if(statSync(file,{throwIfNoEntry:false}))throw new GpuError('Output already exists: '+file);
      renameSync(partial,file);
      results.push({name,path:file,bytes:length});
    }catch(error){try{closeSync(fd);}catch{};try{unlinkSync(partial);}catch{};throw error;}
  }
  return results;
}
