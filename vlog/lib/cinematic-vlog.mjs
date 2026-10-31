import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { relative, resolve, sep } from 'node:path';

export const CINEMATIC_VLOG_STYLE = JSON.parse(readFileSync(new URL('../templates/cinematic-vlog-style.json', import.meta.url), 'utf8'));
const transitions = new Set(CINEMATIC_VLOG_STYLE.transitions.supported);
const q = value => JSON.stringify(String(value));

export function compileCinematicVlog({ scenes, boundaries, music, captions, preset = CINEMATIC_VLOG_STYLE, variant = preset.id, width = preset.format.width, height = preset.format.height, fps = preset.format.fps }) {
  if (!Array.isArray(scenes) || scenes.length < 2) throw new Error('At least two source scenes are required');
  if (!preset.variants.includes(variant)) throw new Error(`Unknown Vlog style variant: ${variant}`);
  if (!music?.path || !music.authorized || !music.sha256 || !music.evidenceRef) throw new Error('Authorized BGM path, hash, and rights evidence are required');
  if (!Array.isArray(boundaries) || boundaries.length !== scenes.length - 1) throw new Error('Every scene boundary needs an edit decision');
  const needsDucking = scenes.some(scene => ['speech', 'dialogue', 'narration', 'meaningful-original-sound'].includes(scene.audioIntent));
  if (needsDucking && (!music.preMixedDucking || !music.duckingEvidenceRef)) throw new Error('Speech or meaningful original sound needs a pre-mixed ducked BGM asset with mix evidence');
  const selected = boundaries.map(b => b.transition);
  if (selected.some(t => !transitions.has(t))) throw new Error(`Unsupported boundary transition; use ${[...transitions].join(', ')}`);
  if (boundaries.some(b => !b.rationale?.trim())) throw new Error('Every boundary decision needs its story or continuity rationale');
  // Markcut's supported Markdown DSL applies a transition to one transitionSeries container.
  if (new Set(selected).size > 1) throw new Error('The supported Markcut Markdown series has one transition setting; choose cuts or one consistent motivated transition for this render');
  const transition = selected[0];
  if (variant.endsWith('-cuts') && transition !== 'cut') throw new Error(`${variant} requires explicit hard-cut decisions`);
  const seconds = boundaries[0].seconds ?? preset.transitions.default.seconds;
  if (transition !== 'cut' && (!Number.isFinite(seconds) || seconds <= 0 || boundaries.some(b => (b.seconds ?? seconds) !== seconds))) throw new Error('All transitions in one Markcut series must use the same positive duration');
  if (!Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(fps)) throw new Error('Invalid output format');
  const root = resolve(process.cwd());
  const sha256 = path => createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex');
  const local = path => {
    const abs = resolve(root, path);
    const rel = relative(root, abs);
    if (rel.startsWith(`..${sep}`) || rel === '..' || abs === root) throw new Error(`Media must be inside the run directory: ${path}`);
    return rel.split(sep).join('/');
  };
  local(music.path);
  if (sha256(music.path) !== music.sha256.toLowerCase()) throw new Error('BGM bytes do not match music.sha256');
  const subtitle = captions?.path ? `\nsubtitle:{type:${q(preset.captions.type)},fontSize:${preset.captions.fontSize},fontFamily:${q(preset.captions.fontFamily)},style:${q(preset.captions.style)},src:${q(local(captions.path))}}` : '';
  const musicEvidence = `BGM sha256 ${music.sha256}; rights evidence ${music.evidenceRef}${music.duckingEvidenceRef ? `; mix evidence ${music.duckingEvidenceRef}` : ''}`;
  const transitionConfig = transition === 'cut' ? '' : ` transition:${transition} transitionTime:${seconds}`;
  const lines = [
    '# video',
    `title:"${variant}"`,
    `width:${width} height:${height} fps:${fps} layout:series${transitionConfig}${subtitle} stt:"" metadata:${q(musicEvidence)}`,
    '',
    `- audio src:${local(music.path)} isBackground:true volume:${preset.audio.bgm_volume}`,
    ''
  ];
  scenes.forEach((scene, index) => {
    if (!scene.id || !scene.path || !['video', 'image'].includes(scene.type) || !(scene.duration > 0)) throw new Error(`Invalid scene at index ${index}`);
    if (!scene.authorized || !scene.sourceHash || !scene.evidenceRef) throw new Error(`Scene ${scene.id} lacks source authorization, hash, or evidence reference`);
    const hashPath = scene.sourceEvidencePath ?? scene.path;
    local(hashPath);
    if (sha256(hashPath) !== scene.sourceHash.toLowerCase()) throw new Error(`Scene ${scene.id} source bytes do not match sourceHash`);
    if (scene.override && (!scene.override.description?.trim() || !scene.override.rationale?.trim() || !scene.override.evidenceRef)) throw new Error(`Scene ${scene.id} override lacks description, rationale, or evidence provenance`);
    if (scene.override?.motion && (scene.type !== 'image' || !['slowPush', 'none'].includes(scene.override.motion))) throw new Error(`Scene ${scene.id} has an unsupported motion override`);
    if (scene.override?.sourceAudioVolume != null && (scene.type !== 'video' || scene.override.sourceAudioVolume < 0 || scene.override.sourceAudioVolume > 1)) throw new Error(`Scene ${scene.id} has an invalid source-audio override`);
    const pacing = index === 0 ? preset.pacing.hook_seconds : index === scenes.length - 1 ? preset.pacing.closing_seconds : null;
    if (pacing && (scene.duration < pacing[0] || scene.duration > pacing[1]) && !scene.override) throw new Error(`Scene ${scene.id} is outside preset pacing; record an evidence-grounded override`);
    if (index === 0 && !scene.beat?.match(/hook/i)) throw new Error('First scene must be an evidence-grounded hook');
    if (index === scenes.length - 1 && !scene.beat?.match(/payoff|closing/i)) throw new Error('Final scene must deliver the story payoff');
    const override = scene.override ? ` Scene-specific override: ${scene.override.description}. Rationale: ${scene.override.rationale}. Evidence: ${scene.override.evidenceRef}.` : '';
    const boundary = index ? ` Boundary edit: ${boundaries[index - 1].transition}. Rationale: ${boundaries[index - 1].rationale}.` : '';
    lines.push(`## ${scene.id}`, 'layout:parallel', `instruction:${q(`${scene.intent ?? scene.beat} [source ${scene.sourceHash}; evidence ${scene.evidenceRef}]${boundary}${override}`)}`);
    if (scene.type === 'image') {
      const visualDuration = Math.max(scene.duration, scene.audioPath ? scene.audioDuration ?? scene.duration : scene.duration);
      const motion = scene.override?.motion ?? 'slowPush';
      const effect = motion === 'slowPush' ? ` effects:${JSON.stringify([{ animation: 'custom', duration: visualDuration, customKeyframes: { 0: { transform: 'scale(1.02)' }, 100: { transform: 'scale(1.08)' } } }])}` : '';
      lines.push(`- image src:${local(scene.path)} duration:${visualDuration} fit:cover${scene.audioPath ? ' isBackground:true' : ''}${effect}`);
      if (scene.audioPath) lines.push(`- audio src:${local(scene.audioPath)} duration:${scene.audioDuration ?? scene.duration} volume:${preset.audio.voice_volume}`);
    } else {
      lines.push(`- video src:${local(scene.path)} duration:${scene.duration} volume:${scene.override?.sourceAudioVolume ?? scene.volume ?? preset.audio.source_video_volume}`);
    }
    lines.push('');
  });
  return lines.join('\n');
}

export function lintCinematicVlog(markdown, { scenes, boundaries, music, captions, preset = CINEMATIC_VLOG_STYLE }) {
  const errors = [];
  if (boundaries?.length !== scenes?.length - 1 || boundaries?.some(b => !b.transition || !b.rationale?.trim())) errors.push('Missing intentional edit decision or rationale at one or more scene boundaries');
  if (!music?.authorized || !music?.sha256 || !music?.evidenceRef || !markdown.includes(`isBackground:true volume:${preset.audio.bgm_volume}`)) errors.push('Authorized BGM bed, hash, or rights evidence is missing');
  if (scenes?.some(scene => ['speech', 'dialogue', 'narration', 'meaningful-original-sound'].includes(scene.audioIntent)) && (!music?.preMixedDucking || !music?.duckingEvidenceRef)) errors.push('Speech/original-sound ducking evidence is missing');
  const choices = boundaries?.map(b => b.transition) ?? [];
  if (choices.some(t => !transitions.has(t)) || new Set(choices).size > 1) errors.push('Boundary choices cannot be represented by this Markcut series');
  const header = markdown.match(/^width:\d+ height:\d+ fps:\d+ layout:series([^\n]*)$/m)?.[1] ?? '';
  if (choices[0] === 'cut' ? /\btransition:/.test(header) : !header.includes(`transition:${choices[0]} transitionTime:${boundaries?.[0]?.seconds ?? preset.transitions.default.seconds}`)) errors.push('Compiled transition setting diverges from the edit decisions');
  for (const scene of scenes ?? []) if (!markdown.includes(scene.sourceHash) || !markdown.includes(scene.evidenceRef)) errors.push(`Source provenance missing from scene ${scene.id}`);
  if (scenes?.[0]?.beat?.toLowerCase() !== 'hook') errors.push('Opening scene is not marked as the hook');
  if (!/payoff|closing/i.test(scenes?.at(-1)?.beat ?? '')) errors.push('Closing scene does not identify the payoff');
  if (captions?.path && !markdown.includes(`style:${q(preset.captions.style)}`)) errors.push('Caption placement diverges from the selected preset');
  if (/\|black|black\|/.test(markdown)) errors.push('Black filler media is forbidden');
  return errors;
}
