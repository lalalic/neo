// The same tiny image works with Neo GPU's batch and web wrappers.
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const signature='hello-neo-v1';
function cudaProof(){
  const out=execFileSync('/usr/local/bin/cuda-probe',[],{encoding:'utf8',timeout:25000});
  const proof=JSON.parse(out);
  if(proof.signature!=='hello-neo-cuda-v1'||proof.cuda!==true||proof.kernelResult!==42||!proof.device)
    throw Error('A real CUDA kernel result is required');
  const {signature:cudaSignature,...validated}=proof;
  return {...validated,cudaSignature};
}
const mode=process.env.NEO_GPU_MODE||'batch';
if(mode==='batch'){
  const inputs=process.env.NEO_GPU_INPUT_DIR||'/neo/input';
  const outputs=process.env.NEO_GPU_OUTPUT_DIR||'/neo/output';
  const input=join(inputs,'request.json');
  const req=existsSync(input)?JSON.parse(readFileSync(input,'utf8')):{message:'hello neo'};
  if(req.message!=='hello neo'||(req.requestId!==undefined&&!/^[a-zA-Z0-9_-]{8,96}$/.test(req.requestId)))
    throw Error('Expected message: hello neo, and an optional safe requestId');
  const proof=cudaProof();
  const result={signature,mode,message:'hello neo',requestId:req.requestId||null,...proof};
  mkdirSync(outputs,{recursive:true});
  writeFileSync(join(outputs,'result.json'),JSON.stringify(result)+'\n');
  console.log('HELLO_NEO_CUDA_BATCH_PASS',proof.device,proof.kernelResult);
} else if(mode==='web'){
  const port=Number(process.env.NEO_GPU_APP_PORT||7860);
  createServer((req,res)=>{
    const path=new URL(req.url,'http://127.0.0.1').pathname;
    res.setHeader('Cache-Control','no-store');
    if(path==='/api/hello'){
      try{
        const proof=cudaProof();
        res.writeHead(200,{'Content-Type':'application/json'});
        res.end(JSON.stringify({signature,mode,message:'hello neo',...proof,
          query:new URL(req.url,'http://127.0.0.1').searchParams.get('nonce'),
          hasNeoCookie:String(req.headers.cookie||'').includes('neo_gpu_'),
          hasProviderToken:String(req.headers.authorization||'').startsWith('Bearer ')}));
      }catch{
        res.writeHead(503,{'Content-Type':'application/json'});
        res.end(JSON.stringify({signature,mode,error:'CUDA kernel unavailable'}));
      }
      return;
    }
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
    res.end('<!doctype html><meta name="viewport" content="width=device-width"><title>Hello Neo GPU</title><h1>Hello Neo</h1><p>Run a real CUDA kernel: 40 + 2 = 42</p><p><a href="./api/hello">Verify CUDA</a></p>');
  }).listen(port,'127.0.0.1',()=>console.log('HELLO_NEO_WEB_READY',port));
} else throw Error('Invalid Neo GPU mode');
