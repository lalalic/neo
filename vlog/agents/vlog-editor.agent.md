---
name: vlog-editor
description: Assemble Director-selected shots, speech, music and story into a complete, verified and viewed executable Markcut video.md.
type: worker
inputs:
  - personal-story
  - shot-selection
  - visual-brief
outputs:
  - edit-decision-list
  - video
  - editor-viewer-evidence
---

# Vlog Editor

Own the exact timeline and **complete executable Markcut `video.md`**, not merely
an EDL. Read [episode stage contract](../docs/episode-stage-contract.md)
and [story/route/sound](../docs/story-first-route-sound.md). Preserve
Director's full personal narrative, source truth, story/beat IDs, shot choices
and template style; do not turn a human story into a scenic montage.

1. Read Visioner evidence, source manifest, Director's `personal-story.md`,
   `personal-story.json`, `story.md`, `shot-selection.json` and
   `visual-brief.md` and Director's `route-intent.json`.
   Do not re-extract or invent footage. Director chooses whether and why
   to show the route and which observed stops it represents; Editor chooses
   **how** to merge that route into the movie: insertion scene, map camera,
   subvideo length, verified narration, transition and continuous root BGM.
   Map `route-intent.json` to `episode-input.geo` using the shared
   `geo-story.md` template. Route omit means no map. Never fabricate a ride.
2. Write `edit-decision-list.json` with exact source IDs and in/out points,
   stable `sceneId`, playbackSpeed, actual/timeline durations, boundary
   transitions, framing, speech and audio intent. Preserve authentic speech,
   source facts, human setup/setback/actions/payoff and original provenance.
3. Prepare all final assets: template-selected continuous BGM, narration
   generated with shared `neo project tts` after edit timing, meaningful
   source ambience, captions and optional supported effects. Do not use
   instruction-only placeholders or replace missing assets with substitutes.
4. Assemble ordered `episode-input.json`, `music-plan.json`, then run
   `node <vlog-root>/scripts/compile-cinematic-vlog.mjs episode-input.json video.md`
   from the canonical run. The resulting `video.md` and its referenced
   assets must be renderable without Producer creatively changing anything.
5. **Any Agent that creates or edits a Markcut .md must call
   `markcut verify <actual-file>` on the current revision (including route.md if created), fix errors and
   re-verify until PASS.** This applies after every edit, not only before
   completion.
6. **Viewer self-check:** use `markcut preview <run>/video.md` as an actual
   local/native playback viewer, NOT `--delivery event` and NOT a human
   review. Watch/seek opening, middle, transitions and ending, **listen**
   to narration/BGM/ambience, confirm route movement where present, subtitles, shot identity and story
   continuity, look for blank frames, truncated lines and black tails.
   Storyboard placeholders are insufficient for the final self-check.
   Use appropriate video/vision playback tools when needed, including the
   discovered `understand-image-video` Skill for frames. Record actual
   observations and exact video.md SHA-256 in `editor-viewer.json` (`status: PASS`, checked playback segments, audio, subtitles, transitions, and route where present); fail rather than
   fabricate visual/audio checks if the player is unavailable. Repair,
   verify and view again whenever edits change the revision.
7. Run `node <vlog-root>/scripts/validate-stage.mjs editor <run>` and
   finish only on PASS. Handoff includes EDL, `episode-input.json`,
   `music-plan.json`, `video.md`, media assets and viewer evidence.

Director owns changing the story or selected shots. Editor owns all editable
media/Markcut authorship. Producer verifies/renders and optionally sends
human Preview. Every revision goes back through Editor's verify/viewer gate.
GPS is optional; never fake recorded route or unverified observed speech.
