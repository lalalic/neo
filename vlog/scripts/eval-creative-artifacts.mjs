#!/usr/bin/env node
/** Non-gating creative eval of real Director/Editor Markdown plus source evidence.
 * Deterministic signals are observations; subjective scores require an explicit judge.
 * This is NOT a substitute for media playback or Stage validity.
 */
import {readFileSync,existsSync,writeFileSync,mkdirSync,realpathSync} from 'node:fs';
import {join,resolve,relative,sep,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const projectRuns=resolve(root,'runs');
const load=(run,name,fallback=null)=>{
 const p=join(run,name);if(!existsSync(p))return fallback;
 return name.endsWith('.json')?JSON.parse(readFileSync(p,'utf8')):readFileSync(p,'utf8');
};
const idsOf=items=>new Set((items??[]).map(x=>x?.source_id).filter(x=>typeof x==='string'));
const unique=x=>[...new Set(x)];
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const detail=(code,message,severity='question')=>({code,message,severity});
const charCount=text=>[...(text??'').replace(/\s/g,'')].length;
const sourceStats=(manifest,used)=>{
 const all=unique((manifest?.media??[]).map(x=>x.id));
 const selected=all.filter(x=>used.has(x));
 return {available:all.length,selected:selected.length,selectedIds:selected,
   omittedIds:all.filter(x=>!used.has(x)),coverageRatio:all.length?Number((selected.length/all.length).toFixed(3)):null};
};
export function inspectDirector({manifest,story='',personalStory='',personal=null,shots=null,visualBrief=''}){
 const chosen=idsOf(shots?.shots);
 const stats=sourceStats(manifest,chosen);
 const beats=Array.isArray(personal?.beats)?personal.beats:[];
 const beatLinks=beats.flatMap(b=>b.source_ids??[]);
 const notes=[];
 if(stats.available>=4&&stats.selected<=Math.max(1,Math.floor(stats.available*.4)))
  notes.push(detail('NARROW_COVERAGE',`Only ${stats.selected}/${stats.available} sources proposed. Consider remaining ${stats.omittedIds.join(', ')} as bridging moments, ambience, context or purposeful omissions; no source quota.`));
 if(stats.available>1&&!/素材盘点|全量素材|取舍理由|source audit|coverage audit|coverage rationale/i.test(visualBrief))
  notes.push(detail('NO_SOURCE_TREATMENT', 'Visual brief should discuss the creative treatment of the full input batch, including justified omissions.'));
 if(!/调侃|自嘲|感想|观察|旁白|幽默|反差|thought|commentary|voice/i.test(story+'\n'+visualBrief))
  notes.push(detail('NO_SUBJECTIVE_VOICE_PLAN','Story plan has no readily identifiable creator commentary, reflection or humor direction; a human judge must decide if intentional quiet explains it.'));
 if(!/source|素材|原声|源|镜头/.test(story))notes.push(detail('STORY_UNLINKED','Story manuscript does not visibly explain its source provenance.'));
 if(!personal?.arc?.outcome&&!/结果|最后|回头|发现|收尾|结尾|payoff|outcome/i.test(story))
  notes.push(detail('UNRESOLVED_ARC','No explicit outcome or intentional open ending is recorded.'));
 return {stage:'director',sourceCoverage:stats,metrics:{storyCharacters:charCount(story),personalStoryCharacters:charCount(personalStory),
  beatCount:beats.length,beatSourceIds:unique(beatLinks),shotCount:shots?.shots?.length??0,
  declaredPillar:personal?.channel_focus?.primary??null,sourceConsiderationNoted:/素材盘点|全量素材|取舍理由|source audit|coverage audit|coverage rationale/i.test(visualBrief)},
  signals:notes};
}
export function inspectEditor({manifest,video='',edl=null,story=''}){
 const edits=Array.isArray(edl?.edits)?edl.edits:[];
 const selected=idsOf(edits);const stats=sourceStats(manifest,selected);
 const sceneHeadings=[...video.matchAll(/^##\s+([^\n]+)/gm)].map(x=>x[1]);
 const videoLines=video.split('\n').filter(s=>/^\s*-\s*(?:video|image)\s/.test(s));
 const transitions=edits.map(e=>e.transition).filter(Boolean);
 const animation=(video.match(/effects\s*:/g)||[]).length;
 const componentNodes=(video.match(/^\s*-\s*component\b/gm)||[]).length;
 const components=Math.max(componentNodes,(video.match(/~~~jsx/g)||[]).length);
 const audioCount=(video.match(/^\s*-\s*audio\s/gm)||[]).length;
 const bgmCount=(video.match(/^\s*-\s*audio\s[^\n]*\bisBackground\s*:\s*true/gm)||[]).length;
 const voiced=videoLines.filter(line=>/volume\s*:\s*(?:0(?:\.\d*[1-9]\d*)?|1(?:\.0*)?)/.test(line)).length;
 const transitionVariety=unique(transitions).length;
 const notes=[];
 if(stats.available>=4&&stats.selected<=Math.max(1,Math.floor(stats.available*.4)))
  notes.push(detail('NARROW_COVERAGE',`Editor used ${stats.selected}/${stats.available} sources; review all unused sources for meaningful coverage, avoid arbitrary filler.`));
 if(sceneHeadings.length>=3&&animation===0&&components===0&&(!transitions.length||transitions.every(t=>t==='cut')))
  notes.push(detail('FLAT_ASSEMBLY',`${sceneHeadings.length} scenes but no executable effects, components or designed transitions. Judge whether this plain-cut approach is a deliberate artistic choice.`));
 if(sceneHeadings.length>=4&&transitions.length>=3&&transitionVariety===1)
  notes.push(detail('MONOTONOUS_TRANSITIONS',`Every recorded boundary uses '${transitions[0]}'. Choose motivated variety or articulate a restrained style.`));
 if(sceneHeadings.length>=3&&new Set(edits.map(e=>e.source_id)).size===1)
  notes.push(detail('ONE_SOURCE_LOOP','Entire edited multi-scene film relies on one source despite other available media. Check whether deliberate concentration is truly warranted.'));
 if(!audioCount)notes.push(detail('NO_AUDIO_DESIGN','The Markdown has no explicit audio stream; judge source audio and sound design against footage.'));
 if(!animation&&!components)notes.push(detail('NO_VISUAL_DESIGN','No executable animated image effects or React components detected. Assess actual output and source motion before prescribing effects.'));
 if(!/给生活加点料/.test(video))notes.push(detail('MISSING_BRAND_INTRO','No literal branded phrase in video.md; a referenced intro asset or audio may still supply it—confirm playback.'));
 return {stage:'editor',sourceCoverage:stats,metrics:{sceneCount:sceneHeadings.length,sceneIds:sceneHeadings,
  visualMediaNodes:videoLines.length,editCount:edits.length,animationCount:animation,componentCount:components,
  transitionTypes:unique(transitions),transitionVariety,audioCount,bgmCount,
  originalAudioCapableVisuals:voiced,storyCharacters:charCount(story),
  shotcraftReferenced:/shotcraft|shot recipe|镜头配方|运镜卡/i.test(video+'\n'+JSON.stringify(edits))},signals:notes};
}
function safeRun(path){const p=realpathSync(resolve(path)),rel=relative(projectRuns,p);
 if(!rel||rel==='..'||rel.startsWith('..'+sep)||rel.startsWith('../')||rel.includes('/..'))throw Error('Creative eval Run must reside within vlog/runs');
 return p;
}
function excerpt(s,limit=11500){return (s||'').slice(0,limit)}
export function buildJudgePrompt({stage,run,inspection,story,personalStory,visualBrief,video,manifest,vision,edl,shots}){
 const rubric=readFileSync(join(root,'.evals','rubrics',stage+'.md'),'utf8');
 const sourceSummary=(vision?.sources??[]).map(x=>({source_id:x.source_id,summary:typeof x.summary==='string'?x.summary.slice(0,500):undefined}));
 return `You are an independent creative Vlog editor and Chinese viewer, NOT the generating Director or Editor.\n\n${rubric}\n\nEvaluate real MARKDOWN QUALITY, not the placeholder labels or existence of JSON fields. Treat programmatic indicators as suggestions, not proof of low quality; judge artistic decisions in context. Do not assume unseen frames or unverifiable audio have been played. Do not invent scenes or treat creative subjective voiceover as evidence of filmed acts. Viewers are in China; persona is a Canadian working IT creator with AI, IT, work permit/PR information, parenting, travel, midlife as six possible focus categories, not all six mandatory.\n\nReturn ONLY one JSON object: {"stage":"${stage}","scores":{"...axis...":{"score":0..5,"evidence":"specific quote/source ID or concrete deficiency","repair":"executable revision"}},"overall":0..5,"verdict":"STRONG|REVISE|NEEDS_EVIDENCE","biggest_problem":"...","best_improvement":"...","unverified":["..."],"material_coverage_decision":"Explain why each omitted source group is relevant or not, and which footage deserves re-inspection"}. Overall is an editorial judgement, never a publish gate. If source descriptions are too thin, say NEEDS_EVIDENCE rather than hallucinating.\n\nRun identifier: ${run.split('/').at(-1)}\nDeterministic source inventory & signals:\n${JSON.stringify({sourceMedia:(manifest?.media??[]).map(x=>({id:x.id,path:x.path,media_type:x.media_type})),sourceSummary,inspection},null,2).slice(0,10000)}\n\nSOURCE-LINKED SHOT SELECTION (JSON):\n${excerpt(JSON.stringify(shots||{},null,2),5500)}\n\nSOURCE-LINKED EDIT DECISION LIST (JSON):\n${excerpt(JSON.stringify(edl||{},null,2),12500)}\n\nSTORY.MD:\n${excerpt(story)}\n\nPERSONAL-STORY.MD:\n${excerpt(personalStory,4500)}\n\nVISUAL-BRIEF.MD:\n${excerpt(visualBrief,5500)}\n\nVIDEO.MD:\n${excerpt(video,12000)}\n`;
}
function parseArgs(args){const out={};for(let i=0;i<args.length;i++){
 const k=args[i];if(k==='--judge'||k==='--prompt-only')out[k.slice(2)]=true;
 else if(['--run','--stage','--output','--model'].includes(k)){if(out[k.slice(2)])throw Error('Repeated '+k);out[k.slice(2)]=args[++i]}
 else throw Error('Unknown creative eval flag '+k);
 }if(!out.run||!['director','editor','both'].includes(out.stage??'both'))throw Error('Usage: node scripts/eval-creative-artifacts.mjs --run ABS_DIR [--stage director|editor|both] [--output ABS_PATH] [--prompt-only|--judge] [--model MODEL]');
 if(out.judge&&out['prompt-only'])throw Error('Select either --judge or --prompt-only');return out;}
export function evaluateRun(run,stage='both'){
 const manifest=load(run,'source-manifest.json',{}),vision=load(run,'vision-evidence.json',{}),story=load(run,'story.md',''),
  personalStory=load(run,'personal-story.md',''),personal=load(run,'personal-story.json',{}),
  visualBrief=load(run,'visual-brief.md',''),shots=load(run,'shot-selection.json',{}),edl=load(run,'edit-decision-list.json',{}),
  video=load(run,'video.md','');
 if(!manifest.media?.length)throw Error('Run has no source-manifest media inventory');
 if(stage!=='editor'&&!story)throw Error('Missing Director story.md');
 if(stage!=='director'&&!video)throw Error('Missing Editor video.md');
 const out={schemaVersion:1,kind:'vlog-creative-artifact-eval',run,stages:{},limitations:[
  'Source inventory/markdown review cannot replace watching real frames and listening to real audio.',
  'Creative scores and coverage signals are advisory; low footage count alone is not a failure.',
  'Draft and real Run data stay private; no public sharing or publishing is authorized.'
 ]};
 const selection=stage==='both'?['director','editor']:[stage];
 for(const s of selection)out.stages[s]=s==='director'
  ?inspectDirector({manifest,story,personalStory,personal,shots,visualBrief})
  :inspectEditor({manifest,video,edl,story});
 return {out,source:{manifest,vision,story,personalStory,visualBrief,video,edl,shots}};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
 try{
  const args=parseArgs(process.argv.slice(2)),run=safeRun(args.run);
  const {out,source}=evaluateRun(run,args.stage??'both');
  const dest=args.output?resolve(args.output):join(run,'creative-eval.json');
  mkdirSync(dirname(dest),{recursive:true});
  if(args.judge||args['prompt-only']){
   for(const [stage,inspection] of Object.entries(out.stages)){
    const prompt=buildJudgePrompt({stage,run,inspection,...source});
    if(args['prompt-only']){out.stages[stage].judge={status:'PROMPT_ONLY',promptPath:dest+'.'+stage+'.prompt.txt'};
      writeFileSync(dest+'.'+stage+'.prompt.txt',prompt);
    }else{
     const output=dest+'.'+stage+'.judge.txt';
     const command=['-C',root,'exec','--sandbox','read-only','--skip-git-repo-check','--output-last-message',output,'-'];
     if(args.model)command.splice(5,0,'--model',args.model);
     const p=spawnSync('codex',command,{input:prompt,encoding:'utf8',timeout:240000,maxBuffer:2e6});
     if(p.status!==0||p.error){out.stages[stage].judge={status:'UNAVAILABLE',reason:(p.error?.message||p.stderr||'').slice(-1000)};}
     else{try{out.stages[stage].judge={status:'REVIEWED',result:JSON.parse(readFileSync(output,'utf8'))};}
       catch{out.stages[stage].judge={status:'UNPARSEABLE',rawPath:output}}}
    }
   }
  }
  mkdirSync(dirname(dest),{recursive:true});writeFileSync(dest,JSON.stringify(out,null,2)+'\n');
  console.log(JSON.stringify({output:dest,stages:out.stages,limitations:out.limitations},null,2));
 }catch(error){console.error(error.message);process.exitCode=1;}
}
