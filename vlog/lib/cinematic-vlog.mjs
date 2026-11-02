import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {relative,resolve,sep} from 'node:path';

const DEFAULT_TEMPLATE = new URL('../templates/cinematic-vlog.md',import.meta.url);
const q = value => JSON.stringify(String(value));
const TOKEN = /\{\{([\w.]+)\}\}/g;
const REQUIRED_BLOCKS = ['SCENE_HOOK','SCENE_BODY','SCENE_CLOSING','VIDEO','IMAGE_MOTION','IMAGE_STATIC','VOICE','SUBTITLE'];

function substitute(block, values) {
  const result=block.replace(TOKEN, (token,key) => {
    if(!Object.hasOwn(values,key)) throw Error('Unknown template binding '+key);
    return String(values[key]);
  });
  if(/\{\{[^}]*\}\}/.test(result))throw Error('Unresolved Markcut template binding');
  return result;
}

export function parseCinematicTemplate(template = readFileSync(DEFAULT_TEMPLATE,'utf8')) {
  const configRx=/<!-- VLOG:CONFIG\s*\n([\s\S]*?)\nVLOG:END_CONFIG -->\s*/;
  const m=configRx.exec(template);
  if(!m)throw Error('Missing Markcut template VLOG:CONFIG');
  const config=JSON.parse(m[1]);
  const blocks={};
  let body=template.replace(configRx,'');
  for(const name of REQUIRED_BLOCKS) {
    const rx=new RegExp('<!-- VLOG:'+name+':BEGIN -->\\s*\\n([\\s\\S]*?)\\n<!-- VLOG:'+name+':END -->\\s*');
    const segment=rx.exec(body);
    if(!segment)throw Error('Missing Markcut template block '+name);
    blocks[name]=segment[1];
    body=body.replace(rx,'');
  }
  if(!body.includes('{{scenes}}') || !body.includes('src:{{music.path}} isBackground:true'))
    throw Error('Markcut template needs scene slots and one root BGM audio leaf');
  if((body.match(/- audio src:\{\{music.path\}\} isBackground:true/g)||[]).length!==1)
    throw Error('Markcut template must define one continuous root BGM');
  if(!config.song?.title || !config.song?.artist || !config.song?.provider)
    throw Error('Markcut template BGM song metadata is required');
  if(!config.format || !config.pacing || !config.transitions || !Number.isFinite(config.audio?.source_video_volume))
    throw Error('Markcut template format and pacing are required');
  if(!config.variants?.includes(config.id))throw Error('Markcut template variant mismatch');
  return {config,blocks,body:body.trim()};
}

export function compileCinematicVlog({
  scenes,boundaries,music,captions,
  variant,width,height,fps
},{templateContent}={}) {
  const {config,blocks,body}=parseCinematicTemplate(templateContent);
  const canonicalSong=parseCinematicTemplate().config.song;
  if(JSON.stringify(config.song)!==JSON.stringify(canonicalSong))
    throw Error('TEMPLATE_SONG_OVERRIDE_FORBIDDEN: change the canonical project template, not a run-local copy');
  variant ??=config.id;
  width ??=config.format.width;
  height ??=config.format.height;
  fps ??=config.format.fps;
  if(!Array.isArray(scenes) || scenes.length<2)throw Error('At least two source scenes are required');
  if(!config.variants.includes(variant))throw Error('Unknown Vlog style variant: '+variant);
  if(!music?.path || !music.sha256 || !music.evidenceRef)
    throw Error('Template-selected BGM path, hash, and provenance are required');
  const songSource = config.song.provider+':'+config.song.vocal_track_id+'+'+config.song.instrumental_track_id;
  if(music.catalogReference!==songSource)
    throw Error('BGM_SOURCE_MISMATCH: run audio asset must match the song selected in the Markcut template');
  if(!Array.isArray(boundaries) || boundaries.length!==scenes.length-1)throw Error('Every scene boundary needs an edit decision');
  const needsDucking=scenes.some(scene=>['speech','dialogue','narration','meaningful-original-sound'].includes(scene.audioIntent));
  if(needsDucking && (!music.preMixedDucking || !music.duckingEvidenceRef))
    throw Error('Speech or meaningful original sound needs a pre-mixed ducked BGM asset with mix evidence');
  const transitions=new Set(config.transitions.supported);
  const selected=boundaries.map(b=>b.transition);
  if(selected.some(t=>!transitions.has(t)))throw Error('Unsupported boundary transition; use '+[...transitions].join(', '));
  if(boundaries.some(b=>!b.rationale?.trim()))throw Error('Every boundary decision needs its story or continuity rationale');
  if(new Set(selected).size>1)throw Error('The supported Markcut Markdown series has one transition setting; choose cuts or one consistent motivated transition for this render');
  const transition=selected[0];
  if(variant.endsWith('-cuts') && transition!=='cut')throw Error(variant+' requires explicit hard-cut decisions');
  const seconds=boundaries[0].seconds ?? config.transitions.default_seconds;
  if(transition!=='cut' && (!Number.isFinite(seconds)||seconds<=0||boundaries.some(b=>(b.seconds??seconds)!==seconds)))
    throw Error('All transitions in one Markcut series must use the same positive duration');
  if(!Number.isFinite(width)||!Number.isFinite(height)||!Number.isFinite(fps))
    throw Error('Invalid output format');
  const root=resolve(process.cwd());
  const sha256=path=>createHash('sha256').update(readFileSync(resolve(root,path))).digest('hex');
  const local=path=>{
    const abs=resolve(root,path);
    const rel=relative(root,abs);
    if(rel.startsWith('..'+sep)||rel==='..'||abs===root)throw Error('Media must be inside the run directory: '+path);
    return rel.split(sep).join('/');
  };
  local(music.path);
  let musicHash;
  try{musicHash=sha256(music.path);}catch{throw Error('MISSING_TEMPLATE_SONG: supply the selected track, not a substitute');}
  if(musicHash!==music.sha256.toLowerCase())throw Error('BGM bytes do not match music.sha256');
  const renderedScenes=[];
  for(const [index,scene] of scenes.entries()) {
    if(!scene.id || !scene.path || !['video','image'].includes(scene.type) || !(scene.duration>0))
      throw Error('Invalid scene at index '+index);
    if(!scene.authorized || !scene.sourceHash || !scene.evidenceRef)
      throw Error('Scene '+scene.id+' lacks source authorization, hash, or evidence reference');
    const hashPath=scene.sourceEvidencePath??scene.path;
    local(hashPath);
    if(sha256(hashPath)!==scene.sourceHash.toLowerCase())
      throw Error('Scene '+scene.id+' source bytes do not match sourceHash');
    if(scene.override && (!scene.override.description?.trim()||!scene.override.rationale?.trim()||!scene.override.evidenceRef))
      throw Error('Scene '+scene.id+' override lacks description, rationale, or evidence provenance');
    if(scene.override?.motion && (scene.type!=='image'||!['slowPush','none'].includes(scene.override.motion)))
      throw Error('Scene '+scene.id+' has an unsupported motion override');
    if(scene.override?.sourceAudioVolume!=null && (scene.type!=='video'||scene.override.sourceAudioVolume<0||scene.override.sourceAudioVolume>1))
      throw Error('Scene '+scene.id+' has an invalid source-audio override');
    const pacing=index===0?config.pacing.hook_seconds:index===scenes.length-1?config.pacing.closing_seconds:null;
    if(pacing && (scene.duration<pacing[0]||scene.duration>pacing[1]) && !scene.override)
      throw Error('Scene '+scene.id+' is outside template pacing; record an evidence-grounded override');
    if(index===0 && !scene.beat?.match(/hook/i))throw Error('First scene must be an evidence-grounded hook');
    if(index===scenes.length-1 && !scene.beat?.match(/payoff|closing/i))
      throw Error('Final scene must deliver the story payoff');
    const override=scene.override?` Scene-specific override: ${scene.override.description}. Rationale: ${scene.override.rationale}. Evidence: ${scene.override.evidenceRef}.`:'';
    const boundary=index?` Boundary edit: ${boundaries[index-1].transition}. Rationale: ${boundaries[index-1].rationale}.`:'';
    const common={'scene.path':local(scene.path),'scene.duration':scene.duration};
    let media;
    if(scene.type==='image'){
      const duration=Math.max(scene.duration,scene.audioPath?scene.audioDuration??scene.duration:scene.duration);
      const block=scene.override?.motion==='none'?'IMAGE_STATIC':'IMAGE_MOTION';
      media=substitute(blocks[block],{...common,'scene.duration':duration,'scene.background':scene.audioPath?' isBackground:true':''});
      if(scene.audioPath){
        try{sha256(scene.audioPath);}catch{throw Error('STORY_VOICEOVER_MISSING: '+scene.id+' audio asset is unreadable');}
        media+='\n'+substitute(blocks.VOICE,{'scene.audio.path':local(scene.audioPath),'scene.audio.duration':scene.audioDuration??scene.duration});
      }
    }else{
      media=substitute(blocks.VIDEO,{...common,'scene.volume':scene.override?.sourceAudioVolume??scene.volume??config.audio.source_video_volume});
      // A scene's spoken story must be rendered as foreground audio, not an instruction.
      if(scene.audioPath){
        if(!(scene.audioDuration>0)||scene.audioDuration>scene.duration)
          throw Error('STORY_VOICEOVER_DURATION: video '+scene.id+' ends before narration');
        try{sha256(scene.audioPath);}catch{throw Error('STORY_VOICEOVER_MISSING: '+scene.id+' audio asset is unreadable');}
        media+='\n'+substitute(blocks.VOICE,{'scene.audio.path':local(scene.audioPath),'scene.audio.duration':scene.audioDuration});
      }
    }
    const slot=index===0?'SCENE_HOOK':index===scenes.length-1?'SCENE_CLOSING':'SCENE_BODY';
    renderedScenes.push(substitute(blocks[slot],{
      'scene.id':scene.id,
      'scene.instruction':q(`${scene.intent??scene.beat} [source ${scene.sourceHash}; evidence ${scene.evidenceRef}]${boundary}${override}`),
      'scene.media':media
    }));
  }
  const song=config.song;
  const metadata=`BGM ${song.title} — ${song.artist}, ${song.provider}; catalog vocal=${song.vocal_track_id??'none'} instrumental=${song.instrumental_track_id??'none'}; template rights=${song.license_status??'unknown'}; asset sha256 ${music.sha256}; rights evidence ${music.evidenceRef}${music.duckingEvidenceRef?'; mix evidence '+music.duckingEvidenceRef:''}`;
  const subtitle=captions?.path?substitute(blocks.SUBTITLE,{'captions.path':q(local(captions.path))}):'';
  const transitionSetting=transition==='cut'?'':` transition:${transition} transitionTime:${seconds}`;
  const output=substitute(body,{
    variant:q(variant),width,height,fps,
    transition:transitionSetting,
    subtitle,
    metadata:q(metadata),
    'music.path':local(music.path),
    scenes:renderedScenes.join('\n\n'),
  }).trim()+'\n';
  if(/<!-- VLOG:|\{\{/.test(output))throw Error('Unrendered Markcut template directives');
  return output;
}

export function lintCinematicVlog(markdown,{scenes,boundaries,music,captions},{templateContent}={}) {
  const issues=[];
  let parsed;
  try{parsed=parseCinematicTemplate(templateContent);}catch(e){return [e.message];}
  const {config}=parsed;
  if(music?.catalogReference!==config.song.provider+':'+config.song.vocal_track_id+'+'+config.song.instrumental_track_id)issues.push('BGM identity differs from the Markcut template');
  if(boundaries?.length!==scenes?.length-1 || boundaries?.some(b=>!b.transition||!b.rationale?.trim()))
    issues.push('Missing intentional edit decision or rationale at one or more scene boundaries');
  if(!music?.sha256 || !music?.evidenceRef || !markdown.includes(`src:${music.path} isBackground:true`))
    issues.push('Authorized BGM bed, hash, or rights evidence is missing');
  if(scenes?.some(s=>['speech','dialogue','narration','meaningful-original-sound'].includes(s.audioIntent)) &&
    (!music?.preMixedDucking||!music?.duckingEvidenceRef))issues.push('Speech/original-sound ducking evidence is missing');
  const choices=boundaries?.map(b=>b.transition)??[];
  if(choices.some(t=>!config.transitions.supported.includes(t))||new Set(choices).size>1)
    issues.push('Boundary choices cannot be represented by this Markcut series');
  const header=markdown.match(/^width:\d+ height:\d+ fps:\d+ layout:series([^\n]*)$/m)?.[1]??'';
  if(choices[0]==='cut'?/\btransition:/.test(header):!header.includes(`transition:${choices[0]} transitionTime:${boundaries?.[0]?.seconds??config.transitions.default_seconds}`))
    issues.push('Compiled transition setting diverges from the edit decisions');
  for(const scene of scenes??[])if(!markdown.includes(scene.sourceHash)||!markdown.includes(scene.evidenceRef))
    issues.push('Source provenance missing from scene '+scene.id);
  if(scenes?.[0]?.beat?.toLowerCase()!=='hook')issues.push('Opening scene is not marked as the hook');
  if(!/payoff|closing/i.test(scenes?.at(-1)?.beat??''))issues.push('Closing scene does not identify the payoff');
  if(captions?.path&&!markdown.includes('src:'+q(captions.path)))issues.push('Captions diverge from the Markcut template');
  if(/\|black|black\|/.test(markdown))issues.push('Black filler media is forbidden');
  if(!markdown.includes(`BGM ${config.song.title} — ${config.song.artist}`))
    issues.push('Rendered BGM identity diverges from the Markcut template');
  return issues;
}
