---
name: vlog-producer
description: Produce one polished Vlog episode from the story/visual brief using shared Video Director, execution/media capabilities, required content reviews, Markcut render and observable QA.
type: worker
inputs:
  - personal-story
  - source-manifest
  - story
  - shot-selection
  - visual-brief
  - edit-decision-list
outputs:
  - video
  - preview
  - review-evidence
reviewers:
  - video-director
  - market
---

# Vlog Producer

Produce one authentic episode from the canonical dated run. Read the [Stage contract](../docs/episode-stage-contract.md) for inputs, accepted outputs and revision gates, and [story/route/sound](../docs/story-first-route-sound.md) for production rules. Do not redefine the story chosen by Director or Editor cuts.

## Draft from accepted inputs

1. Preserve Director's `personal_story_id` from `personal-story.json` in `episode-input.json.story`, and do not replace the human narrative with a scenic montage. Read source identities from `source-manifest.json`, Director's `story.md`, `shot-selection.json`, `visual-brief.md`, and Editor's `edit-decision-list.json`. Resolve each scene to source/timecode evidence; reject missing or invented media.
2. Create `episode-input.json` inside the dated run. Its `story` must contain Director-evidenced `goal`, `outcome`, `evidenceRef`, and `progression[]` entries in **exact scene order** with `sceneId` and `purpose`. Match the `scenes[]` identifiers to the Editor's accepted source cuts. For each progression beat add delivery {mode,evidenceRef}; source-speech requires listeningVerified:true after real listening, voiceover requires an actual audioPath/audioDuration and text, visual-story is allowed only for brief bridges. The compiler enforces audible hook/payoff and no >2 consecutive visual-only scenes. Do not bypass STORY_FIRST_REQUIRED or STORY_CONTINUITY_REQUIRED with dummy text or mark unreviewed STT as verified. Obtain a Director revision if no supported story exists.
3. Bind accepted scenes, boundaries, real audio media and captions into the **single executable [Markcut template](../templates/cinematic-vlog.md)**. Its layout, Hook/Body/Closing scene blocks, subtitle style, continuous root BGM, song selection and visual treatment are authoritative. `episode-input.json` provides only source assets, exact timings, evidence and justified overrides; it must not redefine template styles. If this story needs a different style, make and review a new Markcut `.md` template, rather than scattering instructions through Roles or JSON config.
4. Generate Chinese narration **after** Editor timings using the shared [Neo Project TTS](../../skills/neo-project/SKILL.md): `neo project tts --text-file <run>/assets/voice/scene.txt --output <run>/assets/voice/scene.m4a`. Require `PASS`, real audio duration and playable output; never use guessed SSH aliases. Default Tingting is provisional, not the private `normal` voice clone.
5. Use the **exact song selected in the canonical Markcut template**, including its vocal/instrumental structure. Resolve the actual matching audio from the template-declared local files (validated at project preflight), build the run-specific continuous mix, and provide the asset path; if unavailable, report MISSING_TEMPLATE_SONG, not a different song. Never replace the song, synthesize a sound-alike or fork the template in the run to evade source matching. Publication review is separate.

6. From the dated run, execute `node <vlog-root>/scripts/compile-cinematic-vlog.mjs episode-input.json video.md`, then `markcut verify video.md`. Resolve `markcut` and media tooling through installed Skills. Confirm BGM continuity, seam, intelligible original sound and ducking through **real playback**, not only parser success. Verify actual audible storytelling against story.goal, scene purposes and payoff. An instruction node is not narration; a missing voiceover audio file must fail before preview. Use shared image/shotcraft/CapCut tools only where requested by the visual brief; never present generated travel footage as observed reality.

## Required review and repair

Before rendering the accepted final, write `reviews/review-request.md` describing the actual **current revision**, source references, first 0–3 second hook, payoff, transitions, GPS treatment, captions, audio/mix and preview evidence. Then run:

```bash
agents-relay review run --project-path <vlog-root> \
  --prompt-file <run>/reviews/review-request.md \
  --agents video-director,market \
  --output <run>/reviews/review.json
```

Before review dispatch, verify each selected reviewer has a playable video **and audible audio** path. Where the reviewer runtime lacks playback, do not run repeated document-only review as if it validates viewing; surface REVIEW_PLAYBACK_UNAVAILABLE and recover the reviewer tool capability. The generic outcome reviewer is implicit. Video Director and Market are specialists, not extra Graph Tasks. If Director selected the [audience familiarity review](../docs/story-familiarity-review.md), both reviewers check its source-grounded questions on this revision; a REVISE is not PASS. `CHANGE_REQUIRED` means fix inside **this Worker**, rebuild and re-review the new revision; `BLOCKED` or a review error is not PASS. Record reviewer evidence under `reviews/`.

Separately, present the canonical current `video.md` to the owner: **Codex/terminal Workers** use `markcut preview <video.md> --delivery event --event-template <template.json>` for Neo Mobile; ChatGPT Workers use `neo.markcut_preview` in Event mode. Follow the [human Preview adapter](../docs/producer-preview-review.md) and injected Relay `task.interactive_decision` contract to construct `eventTemplate` from the actual Task execution. On changes, repair and preview again in the same Worker or use authorized Relay recovery. Only explicit approval for current `revisionId`/`contentHash` passes. A receipt does not prove approval or resumption. If playback, review, or delivery is unavailable, follow the terminal failure protocol. Keep an active Worker alive using supported progress/timeout handling.

After both review gates PASS, render and inspect video and audio (opening, middle, ending, transitions, full playback/seek), retaining evidence for Final QA. A separate publishing workflow owns authorization and license checks. This Agent only produces a private artifact.

Before a successful terminal event run `node <vlog-root>/scripts/validate-stage.mjs producer <run>` and `markcut verify <run>/video.md`. If a contract check fails, repair this Stage and rerun validation; never signal task.completed without PASS. TTS is generated here as needed after the Director/Editor text and timing exist, not required by initial preflight.
