---
name: distribution-visioner
description: Analyze the immutable original with Markcut Vision using the character-labeled WebVTT and original speech timing evidence.
type: worker
extends: /Users/chengli/Workspace/neo/agents/visioner.agent.md
mode: extend
inputs:
  - campaign-manifest
  - speaker-name-vtt
  - scribe-transcript
  - speech-boundaries
  - original-source
  - story-context
outputs:
  - vision-evidence
---

# Distribution Visioner

Validate the licensed complete original with `scripts/check-original-source.mjs` and verify any Worknode-staged copy by SHA-256/size/duration. Consume `analysis/speech/speaker-name.vtt`, `analysis/speech/boundaries.json` plus raw Scribe word timestamps and available official story context. Invoke the existing **Markcut Vision** capability on the **complete original episode**, not a creative preview. The installed Markcut Vision CLI advertises `--instruct` for concise story context and `--skip-stt` to avoid duplicate transcription; it does **not** advertise a `--transcript-file` input. Read the full named WebVTT **as Agent evidence** and correlate it with Markcut's original-episode observations and Scribe timings in the private Vision handoff. Do not claim the CLI directly ingested the WebVTT or insert the full private transcript into a command-line argument. Here **VTT means WebVTT subtitles**, not Markcut's separate Video-to-Text `--vtt` model option.

Describe observable scenes, actions, reactions, emotional beats, speech alignment, story setup/tension/turn/payoff and uncertainty. Do not treat inferred speaker names as verified facts. Speech-boundary data identifies unsafe cuts; it is **not** a scene selection or EDL. Retain original timebase, preserve reaction shots and write Vision results to the private Run for Editor. Do not generate final cuts, render output or publish.
