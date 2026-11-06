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
  for(const agent of ['vlog-director','vlog-editor','vlog-producer','vlog-final-qa','video-director','market','planner']){
    assert.ok(words('agents/'+agent+'.agent.md')<=1030,agent+' role overloaded');
  }
});

test('worker role references and mandatory project Markdown links are reachable',()=>{
  const files=[
    'AGENTS.md','README.md','agents/vlog-director.agent.md',
    'agents/vlog-editor.agent.md','agents/vlog-producer.agent.md',
    'agents/vlog-final-qa.agent.md','agents/video-director.agent.md',
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

test('worker prompt can resolve one authoritative story/production path and lifecycle',()=>{
 const project=text('AGENTS.md');
 const director=text('agents/vlog-director.agent.md');
 const editor=text('agents/vlog-editor.agent.md');
 const producer=text('agents/vlog-producer.agent.md');
 const stage=text('docs/episode-stage-contract.md');
 assert.match(project,/Visioner -> vlog-director -> vlog-editor -> vlog-producer -> vlog-final-qa/);
 assert.match(director,/story\.progression\[\]/);
 assert.match(editor,/sceneId/);
 assert.match(producer,/episode-input\.json/);
 assert.match(producer,/STORY_FIRST_REQUIRED/);
 assert.match(producer,/neo\.markcut_preview/);
 assert.match(producer,/markcut preview/);
 assert.match(producer,/--delivery event --event-template/);
 assert.match(text('docs/producer-preview-review.md'),/review_requested/);
 assert.match(producer,/task\.interactive_decision/);
 assert.match(producer,/eventTemplate/);
 assert.match(text('docs/producer-preview-review.md'),/transport receipt alone does not mean/);
 assert.match(producer,/agents-relay review run/);
 assert.match(producer,/same Worker/);
 assert.match(producer,/terminal failure protocol/);
 assert.match(producer,/separate publishing workflow/);
 assert.match(stage,/contentHash/);
 assert.match(project,/separate publication-review workflow/);
 assert.match(text('templates/cinematic-vlog.md'),/license_status.*unverified/);
 assert.match(text('docs/story-first-route-sound.md'),/pre-mixed continuous asset/);
 assert.doesNotMatch(editor,/without source evidence/);
});
