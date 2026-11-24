// Deterministic, dependency-free test app. Same Dockerfile, two Neo build modes.
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const mode=process.env.NEO_GPU_MODE || 'batch';
const signature='neo-gpu-e2e-v1';
if(mode==='batch') {
  const root=process.env.NEO_GPU_INPUT_DIR || '/neo/input';
  const output=process.env.NEO_GPU_OUTPUT_DIR || '/neo/output';
  const req=JSON.parse(readFileSync(join(root,'request.json'),'utf8'));
  if(!/^[A-Za-z0-9_-]{8,96}$/.test(req.requestId||'') || typeof req.text!=='string' || !req.text.length)
    throw Error('Invalid E2E input');
  mkdirSync(output,{recursive:true});
  const result={signature,mode:'batch',requestId:req.requestId,
    textSha256:createHash('sha256').update(req.text).digest('hex'),bytes:Buffer.byteLength(req.text)};
  writeFileSync(join(output,'result.json'),JSON.stringify(result)+'\n');
  console.log('NEO_GPU_E2E_BATCH_PASS',req.requestId);
} else if(mode==='web') {
  const port=Number(process.env.NEO_GPU_APP_PORT||7860);
  createServer((req,res)=>{
    const path=new URL(req.url,'http://localhost').pathname;
    res.setHeader('Cache-Control','no-store');
    if(path==='/api/echo') {
      res.setHeader('Content-Type','application/json');
      res.end(JSON.stringify({signature,mode:'web',path,query:new URL(req.url,'http://localhost').searchParams.get('nonce'),
        hasProviderToken:!!req.headers.authorization?.startsWith('Bearer '),
        hasNeoCookie:String(req.headers.cookie||'').includes('neo_gpu_')}));
      return;
    }
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end('<!doctype html><title>Neo GPU E2E</title><h1>Neo GPU E2E WEB PASS</h1>');
  }).listen(port,'127.0.0.1',()=>console.log('NEO_GPU_E2E_WEB_READY',port));
} else throw Error('Invalid NEO_GPU_MODE');
