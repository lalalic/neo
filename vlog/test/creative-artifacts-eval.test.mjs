import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {inspectDirector,inspectEditor,buildJudgePrompt,evaluateRun} from '../scripts/eval-creative-artifacts.mjs';
const manifest={media:['001','002','003','004','005','006'].map(id=>({id,path:id+'.mov',media_type:'video'}))};
const personal={arc:{outcome:'Find something small worth noticing'},beats:[{source_ids:['001','002']},{source_ids:['003']},{source_ids:['005']}],channel_focus:{primary:'travel_explore'}};
const baselineEdits=ids=>ids.map((id,i)=>({shot_id:'scene'+i,source_id:id,transition:'cut'}));
const flat=(ids=['001','001','001','001'])=>({video:`# video\n${ids.map((x,i)=>`## scene${i}\nlayout:parallel\n- video src:input/media/${x}.mov duration:3 volume:0`).join('\n')}\n`,edl:{edits:baselineEdits(ids)}});
const crafted={video:`# video\n- audio src:assets/music/bed.m4a isBackground:true volume:0.7\n## opener\nlayout:parallel\n- component duration:1.2 jsx:"<div>给生活加点料</div>"\n- audio src:assets/branding/intro.m4a volume:1\n## path\nlayout:parallel transition:slide\n- video src:input/media/001.mov duration:4 volume:0.7\n## laugh\nlayout:parallel transition:wipe\n- image src:input/media/003.jpeg duration:2 effects:[{"animation":"custom"}]\n## outro\nlayout:parallel transition:cut\n- video src:input/media/005.mov duration:3 volume:0.9\n`,edl:{edits:[{source_id:'001',transition:'slide'},{source_id:'003',transition:'wipe'},{source_id:'005',transition:'cut'}]}};

test('Director eval flags a one-source story despite six available and asks for rationale, not filler quota',()=>{
 const weak=inspectDirector({manifest,story:'I saw something.',personalStory:'I walked home.',personal,
  shots:{shots:[{source_id:'001'}]},visualBrief:'one closeup'});
 assert.equal(weak.sourceCoverage.selected,1);
 assert.deepEqual(weak.sourceCoverage.omittedIds,['002','003','004','005','006']);
 assert.ok(weak.signals.some(s=>s.code==='NARROW_COVERAGE'));
 assert.ok(weak.signals.some(s=>s.code==='NO_SOURCE_TREATMENT'));
 const developed=inspectDirector({manifest,story:'借着沿途的细节，再讲一点散步时观察到的反差和感想。',personalStory:'完整故事',personal,
  shots:{shots:['001','003','005'].map(source_id=>({source_id}))},
  visualBrief:'素材盘点：002过曝，004重复角度，006模糊；保留001、003、005，用环境声和动作连接。'});
 assert.equal(developed.sourceCoverage.selected,3);
 assert.ok(!developed.signals.some(s=>s.code==='NO_SOURCE_TREATMENT'));
 assert.ok(!developed.signals.some(s=>s.code==='NARROW_COVERAGE'));
});

test('Editor eval distinguishes bare one-source assembly from executable visual and sonic craft',()=>{
 const simple=flat();const a=inspectEditor({manifest,...simple});
 assert.equal(a.sourceCoverage.selected,1);
 assert.equal(a.metrics.componentCount,0);
 assert.ok(a.signals.some(s=>s.code==='FLAT_ASSEMBLY'));
 assert.ok(a.signals.some(s=>s.code==='ONE_SOURCE_LOOP'));
 assert.ok(a.signals.some(s=>s.code==='MISSING_BRAND_INTRO'));
 const b=inspectEditor({manifest,...crafted});
 assert.equal(b.sourceCoverage.selected,3);
 assert.equal(b.metrics.componentCount,1);
 assert.equal(b.metrics.animationCount,1);
 assert.equal(b.metrics.transitionVariety,3);
 assert.ok(!b.signals.some(s=>s.code==='FLAT_ASSEMBLY'));
 assert.ok(!b.signals.some(s=>s.code==='NO_VISUAL_DESIGN'));
 assert.ok(!b.signals.some(s=>s.code==='MISSING_BRAND_INTRO'));
});

test('Creative judge prompts contain distinct stage rubrics, real-source context, and refuse invented evidence',()=>{
 for(const stage of ['director','editor']){
  const inspection={stage,sourceCoverage:{available:6,selected:1,omittedIds:['002']},signals:[]};
  const prompt=buildJudgePrompt({stage,run:'/vlog/runs/2026-11-09-test',inspection,
   manifest,vision:{sources:[{source_id:'001',summary:'person walks beside fruit trees'}]},
   story:'我的周末',personalStory:'给生活加点料',visualBrief:'素材盘点：只用001',video:flat().video});
  assert.match(prompt,/unverifiable audio|unverifiable|unseen/i);
  assert.match(prompt,/Return ONLY one JSON object/);
  assert.match(prompt,/source_id/);
  assert.match(prompt,/001/);
  if(stage==='director')assert.match(prompt,/whole_batch_judgment/);
  else assert.match(prompt,/visual_craft/);
 }
});

test('A real private historical Run can be evaluated without changing its assets or claiming playback',()=>{
 const dir=join(import.meta.dirname,'..','runs','2026-11-08-editor-craft-pilot');
 if(!readFileSync(join(dir,'source-manifest.json'),'utf8'))throw Error('fixture missing');
 const {out}=evaluateRun(dir,'both');
 assert.equal(out.schemaVersion,1);
 assert.equal(out.stages.director.sourceCoverage.available,6);
 assert.equal(out.stages.editor.metrics.sceneCount,7);
 assert.equal(out.stages.editor.metrics.componentCount,0);
 assert.ok(out.limitations.some(s=>s.includes('watching real frames')));
});
