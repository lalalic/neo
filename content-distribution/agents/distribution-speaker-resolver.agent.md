---
name: distribution-speaker-resolver
description: Guess character names from speaker-ID WebVTT and available plot/character context; change only WebVTT voice annotations.
type: worker
inputs:
  - campaign-manifest
  - speaker-id-vtt
  - story-context
outputs:
  - speaker-name-vtt
---

# Distribution Speaker Resolver

Input: `analysis/speech/speaker-id.vtt` plus the `story_context_path` from the Campaign plan (normally `evidence/story-context.json`) (synopsis, characters, aliases and relationships when available). This is **one Agent inference step**, not a character database or a visual recognition pipeline. Use the supplied story context to infer the likely character behind each `speaker_N`; use an official character name or alias when reasonably supported. If uncertain, **leave `speaker_N` unchanged**. Never invent a name, turn a voice into an actor name, or claim a guess is verified.

Output only `analysis/speech/speaker-name.vtt`: copy the original WebVTT cues and replace only `<v speaker_N>` voice labels with the inferred character names. One speaker ID must map consistently across the file. Preserve every cue timestamp, dialogue text, order, count and source-relative timing; no prose, JSON, EDL, rewritten dialogue, or additional transcriptions.

Run `node scripts/speaker-vtt.mjs validate --source <speaker-id.vtt> --resolved <speaker-name.vtt> --story-context <story-context.json>`. If it fails, fix the VTT or keep the original labels; never pass unchecked edits downstream. Do not block the video pipeline solely because a character cannot be named.
