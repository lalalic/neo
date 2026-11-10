import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync,spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {setTimeout as sleep} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const hello=join(root,'gpu/examples/hello-neo');

test('Hello Neo default image uses no CUDA Toolkit, ML framework or model download',()=>{
  const df=readFileSync(join(hello,'Dockerfile'),'utf8');
  assert.match(df,/FROM node:22-bookworm-slim/);
  assert.match(df,/COPY --from=native-build \/cuda-probe \/usr\/local\/bin\/cuda-probe/);
  assert.match(df,/CMD \["node", "\/app\/app.mjs"\]/);
  assert.doesNotMatch(df.replace(/^#.*$/gm,''),/nvidia\/cuda|pytorch|pip install|cuda-toolkit|curl|wget|model\.bin/i);
});

test('CUDA proof must launch device PTX, synchronize and read back verified result',()=>{
  const code=readFileSync(join(hello,'cuda-probe.c'),'utf8');
  for(const required of ['libcuda.so.1','cuDeviceGetCount','cuCtxCreate_v2','cuModuleLoadData',
    'cuLaunchKernel','cuCtxSynchronize','cuMemcpyDtoH_v2','value!=42'])assert.ok(code.includes(required),required);
  assert.match(code,/add\.u32 %r1, %r1, %r2/);
  const cc=spawnSync('cc',['-std=c11','-Wall','-Wextra','-Werror','-fsyntax-only',join(hello,'cuda-probe.c')],{encoding:'utf8'});
  if(cc.error?.code==='ENOENT')return;
  assert.equal(cc.status,0,cc.stderr);
});

test('Hello Neo batch cannot report success without a real CUDA device',()=>{
  // Outside the container on development machines the CUDA probe binary is absent.
  // This test proves there is no hidden CPU-only success path.
  const dir=mkdtempSync(join(tmpdir(),'hello-neo-no-gpu-'));
  try{
    writeFileSync(join(dir,'request.json'),'{"message":"hello neo"}');
    const run=spawnSync(process.execPath,[join(hello,'app.mjs')],{encoding:'utf8',
      env:{...process.env,NEO_GPU_MODE:'batch',NEO_GPU_INPUT_DIR:dir,NEO_GPU_OUTPUT_DIR:dir},timeout:5000});
    assert.notEqual(run.status,0,'Expected CUDA probe to be mandatory');
    assert.doesNotMatch(run.stdout,/HELLO_NEO_CUDA_BATCH_PASS/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('Hello Neo web requires an available CUDA probe before reporting success',async()=>{
  const port=await new Promise((ok,fail)=>{const server=createServer();server.once('error',fail);
    server.listen(0,'127.0.0.1',()=>{const p=server.address().port;server.close(()=>ok(p));});});
  const worker=spawn(process.execPath,[join(hello,'app.mjs')],{stdio:'ignore',
    env:{...process.env,NEO_GPU_MODE:'web',NEO_GPU_APP_PORT:String(port)}});
  try{
    let response=null;
    for(let i=0;i<50;i++){
      try{response=await fetch(`http://127.0.0.1:${port}/api/hello?nonce=test`);break;}catch{}
      await sleep(70);
    }
    assert.equal(response?.status,503,'Expected missing CUDA probe to return 503, not fake GPU success');
    assert.equal((await response.json()).error,'CUDA kernel unavailable');
  }finally{worker.kill('SIGTERM');await sleep(80);}
});

test('default Hello Neo script is zero-spend unless both live flags are present',()=>{
  const script=join(hello,'e2e.mjs');
  const dry=spawnSync(process.execPath,[script],{encoding:'utf8',timeout:12000});
  assert.equal(dry.status,0,dry.stderr);
  assert.match(dry.stdout,/hello_neo_dry_run_pass/);
  assert.match(dry.stdout,/"providerJobsCreated":0/);
  const vast=spawnSync(process.execPath,[script,'--vast'],{encoding:'utf8',timeout:12000});
  assert.equal(vast.status,0,vast.stderr);
  assert.match(vast.stdout,/"provider":"vast"/);
  const unsafe=spawnSync(process.execPath,[script,'--live'],{encoding:'utf8',timeout:12000});
  assert.equal(unsafe.status,2);
});
