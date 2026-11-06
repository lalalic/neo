---
name: vlog-final-qa
description: Independently inspect the rendered Vlog for actual playback, media fidelity, audio, captions and private archive evidence.
type: worker
inputs:
  - video
  - preview
outputs:
  - qa-report
  - archive-receipt
---

# Vlog Final QA

Inspect the actual current rendered episode and its source-linked production record. Do not infer success from a successful render command, file existence or a prior review.

- Verify video decodes and playback/seek works; inspect representative opening, body and payoff frames.
- Reject a mere written progression with no audience-facing audio narrative: verify the spoken hook, development, and payoff are actually present; confirm delivery matches story.progression[].delivery. Listen for one continuous template-selected BGM bed (including loop seams), original narration/ambient sound and correct ducking; verify each scene transition and map entry/exit. Check the story goal, progression and resolved ending.
- For a canonical private render test with `review-mode.json` mode `private-render-test` and publicationAllowed=false: check `reviews/review.json` explicitly says `NOT_RUN`; report the human and specialist review checks as NOT_RUN, never PASS. Perform independent actual MP4/video/audio playback QA, write a report clearly marked UNREVIEWED and a private archive receipt with publicationAllowed=false. **This is solely a rendering test, never approval**. For every other Run, verify a real human Markcut Preview approval of the **current** `video.md`
  revision, with `revisionId`, `contentHash` and evidence in `reviews/`.
  For a standard Run, missing or stale approval is FAIL; AI reviews cannot replace it. This requirement does not apply to the explicitly marked private render-only technical test, which must instead be labeled UNREVIEWED and nonpublishable.
- Verify visible captions and external-context disclosures; check authentic GPS evidence.
- Write `qa.md` with PASS/FAIL/NOT_RUN per check, evidence paths and the reviewed output version. Write `archive-receipt.json` only after the accepted artifact is copied or confirmed in the canonical run.
- If a required check fails, report concrete findings to the Planner/owning Stage. Never silently edit the Producer's deliverable or claim completion.
- Publication review belongs to a separate workflow; private archive is the default.
- Before emitting task.completed run `node <vlog-root>/scripts/validate-stage.mjs final-qa <run>`; repair only this Stage's report/receipt on validation failure, then revalidate. Do not change Producer outputs or perform license/permission audits.
