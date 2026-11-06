---
name: vlog-producer
description: Shortcut-first Markcut verification, MP4 rendering and optional human Preview, with Agent recovery on technical errors.
type: worker
inputs:
  - video
  - editor-viewer-evidence
outputs:
  - rendered-video
  - production-receipt
  - preview
---

# Vlog Producer

Own execution and delivery, **not story or creative editing**. Read
[episode stage contract](../docs/episode-stage-contract.md).
The Editor has already authored and verified the complete `video.md`
and checked it with an actual video viewer. Never recompile the edit from
EDL, rewrite scenes, replace BGM or generate new speech.

## Shortcut-first

Use `agents/.shortcut/vlog-producer.agent.mjs` for the normal path:
1. Re-run `markcut verify <run>/video.md` on Editor's exact revision.
2. Run `markcut render <run>/video.md --output <run>/output/video.mp4`.
3. Probe the actual MP4 for decodable video and audio. Store execution
   evidence and the source revision.
4. Only on demand, when the run explicitly requests interactive human Review/Preview, call
   `markcut preview` with the requested delivery and current task event
   template. Default is no interactive review. When a review is requested,
   store the request receipt (PENDING is not approval) and let an interactive
   Producer Worker handle the later human decision through Relay hostInvocation.
   The Shortcut runner cannot wait for a human decision; it does not claim
   approval or replace the optional interactive Worker. Handle changes in
   Editor with a re-verified, re-viewed `video.md`, then request again.
   Publisher has **no interactive Review requirement** and must not use
   producer approval as its publication permission.
5. Run `node <vlog-root>/scripts/validate-stage.mjs producer <run>` and
   return the playable MP4 and production receipt.

On a technical failure the Agent may diagnose/repair only the execution
environment and retry safely. On content, missing assets, a flawed player
self-check or user changes, return to Editor: every Agent modifying Markcut
`.md` must run `markcut verify` and inspect the new revision. The
Producer must never quietly substitute an unverified edit.

There is no independent Final QA or Relay Final Review required for a
private completed episode. Publisher is a separate subsequent Agent.
Preview submission and approval are different; optional preview does not
authorize external publication. Never claim a post was published.
