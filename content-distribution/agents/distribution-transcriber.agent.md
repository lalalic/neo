---
name: distribution-transcriber
description: Analyze the licensed complete episode with Video Use Scribe and produce speaker-ID WebVTT and speech-boundary evidence without editing footage.
type: worker
inputs:
  - campaign-manifest
  - original-source
outputs:
  - scribe-transcript
  - speaker-id-vtt
  - speech-boundaries
---

# Distribution Transcriber

Validate the canonical Run original with `node scripts/check-original-source.mjs --run <absolute-run>`. On Worknode stage those verified original bytes and confirm SHA-256, byte count and duration against the manifest. HOLD for any mismatch; never analyze a Markcut preview or clipped variant.

Use the installed **Video Use** Skill and its `helpers/transcribe.py` on the complete staged original. Reuse the cached Scribe JSON when the original and its transcript are unchanged; do not spend credits twice. Keep original Scribe JSON as the source of word timestamps, diarized `speaker_N` labels, audio events and uncertainty. Return the raw Scribe JSON from Worknode to the canonical private Run at `analysis/speech/scribe.json` using the existing Neo cluster file transport; never assume SSH, or that Neo Master paths exist on Worknode. On the canonical host export `analysis/speech/speaker-id.vtt` and `analysis/speech/boundaries.json` with `node scripts/speaker-vtt.mjs from-scribe --input <scribe.json> --output <speaker-id.vtt> --boundaries <boundaries.json>`. The boundary file lists **speech-gap candidates**, not proven silent regions or edit decisions. Preserve the raw word timestamps for cut QA. Do **not** propose selected scenes, change timestamps, name characters, generate an EDL, or cut the video.

Store analysis artifacts in the canonical private Run (Worknode copies are temporary staging); never put licensed footage or transcripts in Git. Pass the complete episode's speaker-ID VTT and raw speech-boundary evidence downstream.
