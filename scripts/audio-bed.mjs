#!/usr/bin/env node
/** Any Neo project: mix licensed music + timed original effects with voice-window
 * ducking into one continuous 48 kHz stereo bed for a video editor.  Original
 * location sound and separately authorized TTS stay on their own tracks.
 * No Vlog, Markcut, Relay, network, or model-specific dependencies.
 */
import {readFileSync, realpathSync, existsSync, mkdirSync, renameSync, rmSync, statSync} from 'node:fs';
import {resolve, dirname, extname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const bounded=(x,min,max,label)=>{
 if(!Number.isFinite(x)||x<min||x>max)throw Error(`${label} must be finite between ${min} and ${max}`);
 return x;
};
const readAudio=(path,label)=>{
 if(typeof path!=='string'||!path.trim())throw Error(`${label}.path must name a real local audio file`);
 const p=realpathSync(resolve(path));
 if(!statSync(p).isFile())throw Error(`${label}.path is not a regular audio file`);
 return p;
};
const close=(a,b)=>Math.abs(a-b)<1e-9;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const rounded=x=>Number(x.toFixed(4));

/** Return a stable, shell-free FFmpeg volume envelope for an arbitrary window set. */
export function makeEnvelope(windows,duckGain,fadeSeconds){
 let expr='1';
 for(const {start,end} of [...windows].reverse()){
  const a=rounded(start),b=rounded(end),f=rounded(fadeSeconds),g=rounded(duckGain);
  const before=rounded(Math.max(0,a-f));
  const up=rounded(b+f);
  const fadeIn=close(a,before)?String(g):`1-(${rounded(1-g)})*(t-${before})/${rounded(a-before)}`;
  const fadeOut=close(b,up)?'1':`${g}+(${rounded(1-g)})*(t-${b})/${f}`;
  expr=`if(between(t,${a},${b}),${g},if(between(t,${before},${a}),${fadeIn},if(between(t,${b},${up}),${fadeOut},${expr})))`;
 }
 // ffmpeg filtergraph commas in expressions must be escaped; no eval/exec.
 return expr.replaceAll(',', '\\,');
}
export function validatePlan(plan){
 if(!plan||typeof plan!=='object'||Array.isArray(plan))throw Error('Audio plan must be a JSON object');
 const duration=bounded(plan.durationSeconds,0.1,21600,'durationSeconds');
 if(!plan.music||typeof plan.music!=='object')throw Error('music source required');
 const music=readAudio(plan.music.path,'music');
 const musicGain=bounded(plan.music.gain??1,0,2,'music.gain');
 const rawWindows=plan.duck?.windows??[];
 if(!Array.isArray(rawWindows)||rawWindows.length>200)throw Error('duck.windows must be an array with at most 200 windows');
 const windows=rawWindows.map((w,i)=>{
  const start=bounded(w.startSeconds,0,duration,'duck window start '+i);
  const end=bounded(w.endSeconds,0,duration,'duck window end '+i);
  if(end<=start)throw Error('duck window has no duration: '+i);
  return {start,end};
 }).sort((a,b)=>a.start-b.start);
 const merged=[];
 for(const w of windows){const prior=merged.at(-1);
  if(prior&&w.start<=prior.end)prior.end=Math.max(w.end,prior.end);
  else merged.push({...w});
 }
 const duckGain=bounded(plan.duck?.gain??0.32,0,1,'duck.gain');
 const fade=bounded(plan.duck?.fadeSeconds??0.18,0,2,'duck.fadeSeconds');
 const rawEffects=plan.effects??[];
 if(!Array.isArray(rawEffects)||rawEffects.length>30)throw Error('effects must be an array with at most 30 original cues');
 const effects=rawEffects.map((effect,i)=>{
  const at=bounded(effect.atSeconds,0,duration,'effect.atSeconds '+i);
  return {path:readAudio(effect.path,'effects['+i+']'),at,volume:bounded(effect.gain??0.6,0,2,'effect.gain '+i)};
 });
 if(typeof plan.output!=='string'||extname(plan.output).toLowerCase()!=='.m4a')throw Error('output must be an .m4a file');
 const output=resolve(plan.output);
 if([music,...effects.map(e=>e.path)].includes(output))throw Error('Refusing to overwrite an input audio source');
 if(existsSync(output))throw Error('Refusing to overwrite an existing output audio file');
 return {duration,music,musicGain,duckGain,fade,windows:merged,effects,output};
}

const run=(bin,args)=>{
 const result=spawnSync(bin,args,{encoding:'utf8',timeout:180000,maxBuffer:3e6});
 if(result.error||result.status!==0)throw Error(`${bin} failed: ${(result.stderr||result.error?.message||'').slice(-1800)}`);
 return result.stdout;
};
export function buildCommand(p,temp){
 const sources=[p.music,...p.effects.map(e=>e.path)];
 const args=['-hide_banner','-loglevel','error','-nostdin','-y'];
 for(let i=0;i<sources.length;i++){
  if(i===0)args.push('-stream_loop','-1');
  args.push('-i',sources[i]);
 }
 const filters=[];
 let envelope=makeEnvelope(p.windows,p.duckGain,p.fade);
 if(!p.windows.length)envelope='1';
 const bedVolume=close(p.musicGain,1)?envelope:`(${p.musicGain})*(${envelope})`;
 filters.push(`[0:a]aresample=48000,aformat=channel_layouts=stereo,atrim=duration=${p.duration},asetpts=PTS-STARTPTS,volume='${bedVolume}':eval=frame[bed]`);
 for(const [i,e] of p.effects.entries()){
  filters.push(`[${i+1}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${Math.round(e.at*1000)}:all=1,atrim=duration=${p.duration},asetpts=PTS-STARTPTS,volume=${e.volume}[fx${i}]`);
 }
 const inputLabels=['[bed]',...p.effects.map((_,i)=>`[fx${i}]`)].join('');
 filters.push(`${inputLabels}amix=inputs=${p.effects.length+1}:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95[out]`);
 return ['ffmpeg',[...args,'-filter_complex',filters.join(';'),'-map','[out]','-t',String(p.duration),'-ar','48000','-ac','2','-c:a','aac','-b:a','192k',temp]];
}
export function render(plan){
 const p=validatePlan(plan);
 mkdirSync(dirname(p.output),{recursive:true});
 const temp=p.output+'.tmp-'+process.pid+'.m4a';
 try{
  const [bin,args]=buildCommand(p,temp);
  run(bin,args);
  const meta=JSON.parse(run('ffprobe',['-v','error','-show_entries','format=duration:stream=codec_type,channels,sample_rate','-of','json',temp]));
  const stream=meta.streams?.find(s=>s.codec_type==='audio');
  if(!stream||stream.sample_rate!=='48000'||stream.channels!==2||!Number.isFinite(+meta.format.duration)||
      Math.abs(+meta.format.duration-p.duration)>.2)throw Error('Rendered audio bed failed duration/stereo decode check');
  renameSync(temp,p.output);
  const bytes=readFileSync(p.output);
  return {status:'COMPLETE',output:p.output,bytes:bytes.length,
    sha256:createHash('sha256').update(bytes).digest('hex'),
    durationSeconds:Number(meta.format.duration),sampleRate:48000,channels:2,
    clipCount:p.effects.length,duckWindows:p.windows.length,editorRootVolume:1.0,
    policy:'Original speech/voiceover remain separate timeline tracks. Mix ducking already applied: do not duck again.'};
 }finally{if(existsSync(temp))rmSync(temp)}
}
if(process.argv[1]&&resolve(process.argv[1])===new URL(import.meta.url).pathname){
 try{
  if(process.argv.length!==4||process.argv[2]!=='--plan')throw Error('Usage: node scripts/audio-bed.mjs --plan /absolute/plan.json');
  const planFile=resolve(process.argv[3]);
  const raw=JSON.parse(readFileSync(planFile,'utf8'));
  // Relative plan entries resolve relative to the plan file, not the caller cwd.
  for(const item of [raw.music,...raw.effects??[]])if(item?.path&&!item.path.startsWith('/'))item.path=resolve(dirname(planFile),item.path);
  if(typeof raw.output==='string'&&!raw.output.startsWith('/'))raw.output=resolve(dirname(planFile),raw.output);
  console.log(JSON.stringify(render(raw),null,2));
 }catch(e){console.error(e.message);process.exitCode=1}
}
