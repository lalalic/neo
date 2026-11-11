import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {imagePlan} from '../gpu/image.mjs';

const root=resolve(import.meta.dirname,'..');
const docker=readFileSync(join(root,'gpu/examples/comfyui/Dockerfile'),'utf8');

test('prebuilt ComfyUI image is immutable, inherits upstream CMD, and avoids installers',()=>{
  assert.match(docker,/^FROM docker\.io\/yanwk\/comfyui-boot:cu130-slim-20261109@sha256:[0-9a-f]{64}$/m);
  assert.match(docker,/^ENV CLI_ARGS="--disable-auto-launch"$/m);
  assert.doesNotMatch(docker,/^(?:RUN|COPY|ADD|CMD|ENTRYPOINT|VOLUME)\s/m);
  assert.equal(existsSync(join(root,'gpu/examples/comfyui/start.sh')),false);
});

test('Neo Compute builds ComfyUI as a web service on upstream port 8188',()=>{
  const plan=imagePlan({project:root,dockerfile:'gpu/examples/comfyui/Dockerfile',mode:'web',port:'8188',name:'comfyui',dry_run:true});
  assert.equal(plan.mode,'web');
  assert.equal(plan.appPort,8188);
  assert.equal(plan.name,'comfyui');
  assert.match(plan.image,/^ghcr\.io\/lalalic\/neo-gpu:sha-[0-9a-f]{12}$/);
});
