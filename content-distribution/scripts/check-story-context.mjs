import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const evidenceKinds = new Set(['face_lip_sync', 'on_screen_name', 'subtitle_speaker_tag', 'direct_dialogue', 'voice_consistency', 'human_verification']);
const identityKinds = new Set(['on_screen_name', 'subtitle_speaker_tag', 'direct_dialogue', 'human_verification']);
const alignmentKinds = new Set(['face_lip_sync', 'voice_consistency', 'human_verification']);

export function validateStoryContext(doc) {
  const errors = [];
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return ['context must be an object'];
  for (const key of ['title', 'provider_id', 'synopsis']) {
    if (typeof doc[key] !== 'string' || !doc[key].trim()) errors.push(`${key} is required`);
  }
  if (!Array.isArray(doc.sources) || doc.sources.length === 0) errors.push('at least one official source is required');
  else for (const [i, source] of doc.sources.entries()) {
    if (!['provider_api', 'provider_web', 'official_web'].includes(source?.kind)) errors.push(`sources[${i}].kind invalid`);
    if (typeof source?.url !== 'string' || !source.url.startsWith('https://')) errors.push(`sources[${i}].url must be HTTPS`);
    if (typeof source?.observed_at !== 'string' || Number.isNaN(Date.parse(source.observed_at))) errors.push(`sources[${i}].observed_at invalid`);
  }
  const characterNames = new Set();
  if (!Array.isArray(doc.characters) || doc.characters.length === 0) errors.push('named characters required');
  else for (const [i, character] of doc.characters.entries()) {
    if (!character?.name?.trim() || !character?.description?.trim()) errors.push(`characters[${i}] requires name and description`);
    else if (characterNames.has(character.name)) errors.push(`duplicate character ${character.name}`);
    else characterNames.add(character.name);
  }
  for (const character of doc.characters ?? []) for (const relation of character.relationships ?? []) {
    if (!characterNames.has(relation.to)) errors.push(`${character.name} relationship target not in roster: ${relation.to}`);
  }
  if (doc.speaker_map !== undefined && !Array.isArray(doc.speaker_map)) errors.push('speaker_map must be an array when supplied (legacy only)');
  else if (Array.isArray(doc.speaker_map)) {
    const speakerIds = new Set();
    for (const [i, speaker] of doc.speaker_map.entries()) {
      if (!/^speaker_\d+$/.test(speaker?.speaker_id ?? '')) errors.push(`speaker_map[${i}] invalid speaker ID`);
      if (speakerIds.has(speaker?.speaker_id)) errors.push(`duplicate speaker ID ${speaker?.speaker_id}`);
      speakerIds.add(speaker?.speaker_id);
      if (!['unresolved', 'candidate', 'verified'].includes(speaker?.status)) errors.push(`speaker_map[${i}] invalid status`);
      if (speaker?.status === 'unresolved' && speaker.character_name !== null) errors.push(`speaker_map[${i}] unresolved speaker must not have a character name`);
      if (speaker?.character_name != null && !characterNames.has(speaker.character_name)) errors.push(`speaker_map[${i}] character not in sourced roster`);
      if (!Array.isArray(speaker?.evidence)) { errors.push(`speaker_map[${i}] evidence array required`); continue; }
      const kinds = new Set();
      for (const [j, e] of speaker.evidence.entries()) {
        if (!evidenceKinds.has(e?.kind) || !Number.isFinite(e?.start_s) || !Number.isFinite(e?.end_s) || e.start_s < 0 || e.end_s <= e.start_s || !e?.observation?.trim()) errors.push(`speaker_map[${i}].evidence[${j}] invalid`);
        kinds.add(e?.kind);
      }
      if (speaker?.status === 'verified') {
        if (!characterNames.has(speaker.character_name)) errors.push(`speaker_map[${i}] verified name must be in roster`);
        if (speaker.evidence.length < 2 || kinds.size < 2 || ![...kinds].some(k => identityKinds.has(k)) || ![...kinds].some(k => alignmentKinds.has(k))) errors.push(`speaker_map[${i}] verified identity requires independent name and audio/face alignment evidence`);
      }
    }
  }
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const file = process.argv[2];
  if (!file) { console.error('Usage: node scripts/check-story-context.mjs /absolute/path/to/story-context.json'); process.exit(2); }
  try {
    const errors = validateStoryContext(JSON.parse(readFileSync(resolve(file), 'utf8')));
    if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
    else console.log('Story context OK; speaker names are resolved in WebVTT.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
