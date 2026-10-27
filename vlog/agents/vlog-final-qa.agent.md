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
- Listen for narration, original dialogue, BGM balance, silence/clipping and transitions.
- Verify visible captions and external-context disclosures; respect source rights and private-location redaction.
- Write `qa.md` with PASS/FAIL/NOT_RUN per check, evidence paths and exact reviewed output version/hash. Write a private archive receipt only after the accepted artifact is copied or confirmed in the canonical run.
- If a required check fails, report concrete findings to the Planner/owning Stage. Never silently edit the Producer's deliverable or claim completion.
- Publication remains a separate authorized action; private archive is the default.
