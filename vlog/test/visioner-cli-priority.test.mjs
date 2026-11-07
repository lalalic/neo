import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

const vlogRoot=fileURLToPath(new URL('../',import.meta.url));
const neoRoot=resolve(vlogRoot,'..');
const markcutRoot=process.env.MARKCUT_ROOT || resolve(neoRoot,'../markcut');
const visioner=readFileSync(resolve(vlogRoot,'agents/vlog-visioner.agent.md'),'utf8');
const contract=readFileSync(resolve(vlogRoot,'docs/episode-stage-contract.md'),'utf8');

test('Neo Visioner prefers DeepSeek as first generic Markcut ITT/VTT CLI templates',()=>{
 const preferred=visioner.slice(visioner.indexOf('## First choice:'),visioner.indexOf('## Coordinated output:'));
 assert.match(preferred,/first option is DeepSeek Web/);
 assert.match(preferred,/--itt "node \$neo_root\/agents\/visioner-adapters\/deepseek-infer\.mjs --input \{input\} --prompt \{prompt_quoted\}"/);
 assert.match(preferred,/--vtt "node \$neo_root\/agents\/visioner-adapters\/deepseek-infer\.mjs --input \{input\} --prompt \{prompt_quoted\} --sample-interval \{sample_interval\}"/);
 assert.match(preferred,/--instruct/);
 assert.match(preferred,/--agent/);
 assert.match(preferred,/--stt/);
 assert.match(preferred,/--dry-run/);
 assert.match(preferred,/reuse valid `metadata\.json`/);
 assert.doesNotMatch(visioner,/--backend\b|\bbackend=deepseek\b/);
 assert.doesNotMatch(contract,/--backend\b|\bbackend=deepseek\b/);
 assert.match(contract,/Visioner/);
 assert.match(contract,/source index/);
});

test('Visioner CLI fallback never treats failed DeepSeek as success',()=>{
 const preferred=visioner.slice(visioner.indexOf('## First choice:'),visioner.indexOf('## Coordinated output:'));
 assert.match(preferred,/If the first option is unavailable or fails, report/);
 assert.match(preferred,/another configured ITT\/VTT CLI template/);
 assert.match(preferred,/Never silently accept blank\/truncated responses/);
 assert.match(visioner,/original source time/);
});

test('Markcut CLI parses the first-choice hooks without any provider switch', {skip:!existsSync(resolve(markcutRoot,'src/config.mjs'))},()=>{
 const cfg=resolve(markcutRoot,'src/config.mjs');
 const hook=resolve(neoRoot,'agents/visioner-adapters/deepseek-infer.mjs');
 const itt=`node ${hook} --input {input} --prompt {prompt_quoted}`;
 const vtt=`node ${hook} --input {input} --prompt {prompt_quoted} --sample-interval {sample_interval}`;
 const js=`process.argv=[process.execPath,'markcut','vision','/tmp/fake-source','--itt',${JSON.stringify(itt)},'--vtt',${JSON.stringify(vtt)}];
const mod=await import(${JSON.stringify('file://'+cfg)});
process.stdout.write(JSON.stringify({itt:mod.DEFAULT_ITT_CLI,vtt:mod.DEFAULT_VTT_CLI}));`;
 const raw=execFileSync(process.execPath,['--input-type=module','--eval',js],{encoding:'utf8'});
 const got=JSON.parse(raw);
 assert.equal(got.itt,itt);
 assert.equal(got.vtt,vtt);
});
