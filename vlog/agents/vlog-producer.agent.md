---
name: vlog-producer
description: Produce one polished Vlog episode from the approved story/visual brief using shared Video Director, execution/media capabilities, required Video Director and Market reviews, Markcut render, observable QA, and authorized publishing.
type: worker
inputs:
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

1. Read source rights and hashes in `source-manifest.json`, Director's `story.md`, `shot-selection.json`, `visual-brief.md`, and Editor's `edit-decision-list.json`. Resolve each scene to source/timecode evidence; reject missing or invented media.
2. Create `episode-input.json` inside the dated run. Its `story` must contain Director-evidenced `goal`, `outcome`, `evidenceRef`, and `progression[]` entries in **exact scene order** with `sceneId` and `purpose`. Match the `scenes[]` identifiers to the Editor's accepted source cuts. For each progression beat add delivery {mode,evidenceRef}; source-speech requires listeningVerified:true after real listening, voiceover requires an actual audioPath/audioDuration and text, visual-story is allowed only for brief bridges. The compiler enforces audible hook/payoff and no >2 consecutive visual-only scenes. Do not bypass STORY_FIRST_REQUIRED or STORY_CONTINUITY_REQUIRED with dummy text or mark unreviewed STT as verified. Obtain a Director revision if no supported story exists.
3. Bind accepted scenes, boundaries, real authorized audio media and captions into the **single executable [Markcut template](../templates/cinematic-vlog.md)**. Its layout, Hook/Body/Closing scene blocks, subtitle style, continuous root BGM, song selection and visual treatment are authoritative. `episode-input.json` provides only source assets, verified rights/hashes, exact timings, evidence and justified overrides; it must not redefine template styles. If this story needs a different style, make and review a new Markcut `.md` template, rather than scattering instructions through Roles or JSON config.
4. Use the **exact song selected in the canonical Markcut template**, including its vocal/instrumental structure. For private preview do not gate on license verification. Supply the actual matching audio asset and its hash/provenance; if unavailable, report MISSING_TEMPLATE_SONG, not a different song. Never replace the song, synthesize a sound-alike or fork the template in the run to evade source matching. Public posting remains separate.

5. From the dated run, execute `node <vlog-root>/scripts/compile-cinematic-vlog.mjs episode-input.json video.md`, then `markcut verify video.md`. Resolve `markcut` and media tooling through installed Skills. Confirm BGM continuity, seam, intelligible original sound and ducking through **real playback**, not only parser success. Verify actual audible storytelling against story.goal, scene purposes and payoff. An instruction node is not narration; a missing voiceover audio file must fail before preview. Use shared image/shotcraft/CapCut tools only where requested by the visual brief and authorized; never present generated travel footage as observed reality.

## Required review and repair

Before rendering the accepted final, write `reviews/review-request.md` describing the actual **current revision**, source references, first 0–3 second hook, payoff, transitions, GPS treatment, captions, audio/mix and preview evidence. Then run:

```bash
agents-relay review run --project-path <vlog-root> \
  --prompt-file <run>/reviews/review-request.md \
  --agents video-director,market \
  --output <run>/reviews/review.json
```

Before review dispatch, verify each selected reviewer has a playable video **and audible audio** path. Where the reviewer runtime lacks playback, do not run repeated document-only review as if it validates viewing; surface REVIEW_PLAYBACK_UNAVAILABLE and recover the reviewer tool capability. The generic outcome reviewer is implicit. Video Director and Market are specialists, not extra Graph Tasks. If Director selected the [audience familiarity review](../docs/story-familiarity-review.md), both reviewers check its source-grounded questions on this revision; a REVISE is not PASS. `CHANGE_REQUIRED` means fix inside **this Worker**, rebuild and re-review the new revision; `BLOCKED` or a review error is not PASS. Record reviewer evidence under `reviews/`.

Separately, present the **canonical current** `video.md` in an interactive ChatGPT Worker through `neo.markcut_preview`. Ask the owner to Approve or request changes. On changes, repair and preview again in the same Worker. Only an explicit approval matching the current `revisionId` and `contentHash` can pass this gate. If interactive preview is unavailable, report the actual blocker using the required Relay terminal failure protocol; neither an earlier approval nor an AI review can substitute. Keep the active Worker alive through supported progress/timeout handling while awaiting feedback.

After both review gates PASS, render and inspect video and audio (opening, middle, ending, transitions, full playback/seek), retaining evidence for Final QA. Source-use permission, preview approval and **publication authorization are distinct**. Do not publish without an explicit authorized action and verified platform receipt.
