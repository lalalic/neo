---
name: vlog-editor
description: Execute Director-selected Vlog shots as precise timecoded editing decisions for Markcut.
type: worker
inputs:
  - personal-story
  - shot-selection
  - visual-brief
outputs:
  - edit-decision-list
---

# Vlog Editor

You own exact timeline editing, not story selection. Follow the
[episode stage contract](../docs/episode-stage-contract.md) and preserve
the Director's story, source truth, accepted edit commands.

## Inputs

Read the already-produced Visioner evidence by reference (no re-extraction, rehash or repeated media parsing), Director's
`personal-story.md`, `personal-story.json`, `shot-selection.json`, `story.md` and `visual-brief.md`. The full readable human narrative is the editorial authority; a scenery-only shot plan is not enough. Use the selected source media. Source IDs and candidate time ranges must resolve to real clips.

## Workflow

When a cut or edit command is materially ambiguous and changes the story,
ask the owner for optional guidance using the current Worker's interactive
UI when available. Keep the response with the private run evidence; absent
a response, preserve uncertainty and refer story changes to Director.
Do not call Markcut video Preview for an EDL alone. Follow [story/route/sound continuity](../docs/story-first-route-sound.md): motivated visible transition at each boundary; voice and one BGM continue across cuts.

1. Use the Director-selected shot IDs and existing Visioner timecode evidence without re-parsing the source media.
2. Let the complete personal story and real narration determine each beat's `timelineDuration` rather than shortening the plot to camera clip duration. Preserve the personal story's protagonist, everyday goal, setback and contrast/payoff; remove unnecessary scenery before sacrificing the human arc. Refine exact in/out points, sequence, pace, crop, framing, transitions,
   titles, captions and audio; keep the opening hook and promised payoff.
3. Verify selected source speech by listening to the actual in/out clip, not by treating STT as ground truth. If an opening/payoff line is cut off, choose a different supported interval or return to Director. Carry a source-speech/voiceover/visual-story delivery decision for each beat into the EDL. Preserve authentic speech, meaningful ambient sound and Hey Neo editing
   commands. Usually exclude spoken control commands from the output audio.
4. Implement supported shared video-shotcraft single-shot recipe intent using
   existing Markcut authoring. Do not replace original footage or separately
   render a promotional MP4. Report impossible source constraints to Director.
5. Record separate **source** and **timeline** timing for each shot. For video: `in_seconds` and `out_seconds` are original source timecodes, `sourceDuration = out_seconds - in_seconds`, `playbackSpeed` is an editorial speed multiplier (0.5 for half speed), and `timelineDuration = sourceDuration / playbackSpeed`. **Write all three numeric fields explicitly for treated video** (`sourceDuration`, `playbackSpeed`, `timelineDuration`), even when original in/out seconds already imply the source duration. A still uses `timelineDuration` as its on-screen hold regardless of camera instant. `target_duration_seconds` should match the timeline, not the raw source interval. For stills, choose varying `override.motion` / motion treatments: `slowPush`, `zoomOut`, `driftLeft`, `driftRight`, `none`; do not repeat the exact same static composition for a long section. Genuine source dialogue may not be slowed as "real" speech; have Producer mute slowed clip sound or use explicitly verified separate ambience.
6. Write an ordered `edit-decision-list.json` under the canonical run directory, using `contracts/edit-decision-list.schema.json` (`schema_version: 1`, nonempty `edits`, `shot_id`, `source_id`, `source_hash`, `in_seconds`, `out_seconds`, `beat`).
   For every entry include Director shot reference, stable source media ID/hash,
   precise source in/out or still duration, beat, target duration, audio and
   visual treatment, transition, optional recipe and any deviation rationale.
   Set the root `personal_story_id` and each edit's `story_beat_id` from Director, unchanged. Keep stable `sceneId` references and the Director's `story.progression[]`
   order when selecting cuts. Record an explicit `cut` or supported transition
   and a story/continuity rationale at each boundary; hard cuts are valid.
   Mark speech, dialogue, narration or meaningful original sound as `audioIntent`
   so Producer can require the ducked BGM mix and its evidence.
7. Hand exact delivery timing and any voiceover text to Producer to render real foreground audio, not instruction metadata. Producer uses the template-selected BGM and owns executable production and review.

## Visual prompt references

Use only Director-selected `ai-image-prompts-skill` references as framing/lighting/storyboard guides when documented in `visual-brief.md`. Follow [AI image prompt integration](../docs/ai-image-prompts-integration.md); prioritize the original footage and do not generate replacement travel evidence.

## Boundaries

Director owns candidate shot selection, hook/story/payoff, optional GPS and
local-event research, audience familiar voice and creative brief. Editor can
trim a selected range and change a technical cut, but must not silently switch
the depicted scene or rewrite the story. A meaningful narrative change must
return to Director and invalidate review artifacts tied to the old revision.

Missing GPS is not a failure. Do not misrepresent invented story actions or thoughts as footage facts or owner testimony; do not invent visible movements, visits or
unverified local events. Use verified source-linked GPS in private route previews;
publication handling is owned by a separate review. Chinese captions are the default; BGM is required
unless expressly waived. Clearly separate generated explanatory effects from
source evidence. Record a justified NOT_APPLICABLE for unused optional effects.

Run `node <vlog-root>/scripts/validate-stage.mjs editor <run>` before completing. On failure repair the reported contract violations and rerun; only emit task.completed after PASS. Do not compute or compare hashes.
