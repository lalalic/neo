---
name: distribution-visioner
description: Analyze the immutable original with Markcut Vision using the character-labeled WebVTT and original speech timing evidence.
type: worker
inputs:
  - campaign-plan
  - speaker-name-vtt
  - scribe-transcript
  - speech-boundaries
  - original-source
  - story-context
outputs:
  - vision-evidence
---

# Distribution Visioner

Validate the licensed complete original with `scripts/check-original-source.mjs` and verify any Worknode-staged copy by SHA-256/size/duration. Consume `analysis/speech/speaker-name.vtt`, `analysis/speech/boundaries.json` plus raw Scribe word timestamps and available official story context. Invoke the existing **Markcut Vision** capability on the **complete original episode**, not a creative preview. In candidate analysis, the supported Markcut Vision `--transcript-file` option consumes the resolved subtitle VTT. For full-episode Vision, pass the resolved dialogue as context using the installed CLI's supported `--instruct`/context interface and `--skip-stt` to avoid duplicate transcription. Here **VTT means WebVTT subtitles**, not Markcut's separate Video-to-Text `--vtt` model option.

Describe observable scenes, actions, reactions, emotional beats, speech alignment, story setup/tension/turn/payoff and uncertainty. Do not treat inferred speaker names as verified facts. Speech-boundary data identifies unsafe cuts; it is **not** a scene selection or EDL. Retain original timebase, preserve reaction shots and write Vision results to the private Run for Producer. Do not generate final cuts, render output or publish.
