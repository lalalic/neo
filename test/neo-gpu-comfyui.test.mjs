import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,chmodSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

const root=resolve(import.meta.dirname,'..');
const docker=readFileSync(join(root,'gpu/examples/comfyui/Dockerfile'),'utf8');
const start=join(root,'gpu/examples/comfyui/start.sh');

test('ComfyUI image disables the upstream supervisor and exposes only an app CMD',()=>{
  assert.match(docker,/FROM pytorch\/pytorch:2\.12\.1-cuda12\.6-cudnn9-runtime/);
  assert.match(docker,/ARG COMFYUI_TAG=v0\.45\.0/);
  assert.match(docker,/venv --system-site-packages/);
  assert.match(docker,/ENTRYPOINT \[\]/);
  assert.match(docker,/CMD \["\/bin\/bash", "\/opt\/neo\/comfyui-start\.sh"\]/);
  assert.doesNotMatch(docker,/USER .*root\b.*?RUN .*curl.*token/s);
});

test('ComfyUI starts on the assigned Neo port with session-local directories',()=>{
  const tmp=mkdtempSync(join(tmpdir(),'neo-comfy-'));
  try{
    const fake=join(tmp,'python');
    writeFileSync(fake,`#!/usr/bin/env bash\nprintf '%s\\n' "$@" > "${tmp}/args"\n`);
    chmodSync(fake,0o755);
    const out=spawnSync('bash',[start],{env:{...process.env,COMFYUI_PYTHON:fake,COMFY_DATA_DIR:join(tmp,'data'),NEO_GPU_APP_PORT:'8188'},encoding:'utf8'});
    assert.equal(out.status,0,out.stderr);
    const args=readFileSync(join(tmp,'args'),'utf8');
    assert.match(args,/--listen\n0\.0\.0\.0\n--port\n8188/);
    assert.match(args,/--base-directory\n.*\/data/);
    for(const name of ['models','input','output','temp','user'])assert.ok(existsSync(join(tmp,'data',name)));
  }finally{rmSync(tmp,{recursive:true,force:true});}
});
