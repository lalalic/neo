import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const text = name => readFileSync(resolve(root,name),'utf8');
const words = name => text(name).split(/\s+/).filter(Boolean).length;

test('project startup, role and stage contracts remain within Markdown review budgets',()=>{
  assert.ok(words('AGENTS.md')<=1120,'shared startup policies overloaded');
  assert.ok(words('docs/episode-stage-contract.md')<=1350,'stage contract overloaded');
  for(const agent of ['vlog-director','vlog-editor','vlog-producer','vlog-publisher','video-director','market','planner']){
    assert.ok(words('agents/'+agent+'.agent.md')<=1030,agent+' role overloaded');
  }
});

test('worker role references and mandatory project Markdown links are reachable',()=>{
  const files=[
    'AGENTS.md','README.md','agents/vlog-director.agent.md',
    'agents/vlog-editor.agent.md','agents/vlog-producer.agent.md',
    'agents/vlog-publisher.agent.md','agents/video-director.agent.md',
    'agents/market.agent.md','docs/episode-stage-contract.md',
    'docs/story-first-route-sound.md','docs/geo-story-production.md',
    'docs/optional-media-tools.md'
  ];
  for(const file of files){
    for(const match of text(file).matchAll(/\[[^\]]+\]\(([^)]+)\)/g)){
      const target=match[1].split('#')[0];
      if(!target || target.startsWith('https:') || target.startsWith('http:'))continue;
      assert.ok(existsSync(resolve(root,dirname(file),target)),file+' has broken ref '+target);
    }
  }
});

test('assembled roles have verified Markcut Editor, Producer render, conditional Publisher',()=>{
 const project=text('AGENTS.md'),director=text('agents/vlog-director.agent.md');
 const editor=text('agents/vlog-editor.agent.md'),producer=text('agents/vlog-producer.agent.md');
 const publisher=text('agents/vlog-publisher.agent.md'),stage=text('docs/episode-stage-contract.md');
 assert.match(project,/Visioner/);assert.match(project,/Publisher/);
 assert.match(director,/route-intent.json/);
 assert.match(editor,/markcut verify/);
 assert.doesNotMatch(editor,/markcut preview <run>/);
 assert.match(editor,/Do not launch or require/);
 assert.match(producer,/markcut verify/);
 assert.match(producer,/markcut render/);
 assert.match(publisher,/wechat-channels/);assert.match(publisher,/xhs/);
 assert.match(stage,/publishing/);
 assert.match(text('templates/cinematic-vlog.md'),/license_status.*unverified/);
 assert.match(text('docs/story-first-route-sound.md'),/pre-mixed continuous asset/);
});
