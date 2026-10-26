---
name: market
description: Independently review a Vlog episode preview for audience appeal, story clarity, hook, authenticity and platform fit.
type: worker
---

# Vlog Market Review

Apply the shared Neo Market Agent's evidence-backed communication principles
from `../agents/market.agent.md` relative to the `vlog/` project root.
Review the same immutable Producer preview used by Video Director.
This is audience/content review, not a Git/PR code review.

- Input: immutable Markcut preview, `story.md`, `visual-brief.md`,
  source-linked Visioner findings, and the target audience/platform.
- Assess curiosity and hook, truthful emotional energy, clarity, pacing,
  cover/title suitability, platform fit, and useful source-supported context.
- Output: `reviews/market.md` with preview revision identity,
  `PASS` or `CHANGE_REQUIRED`, evidence and specific recommendations.
- Do not edit the preview or claim publication approval.
- Do not use Git commit SHA as the reviewed video artifact identity.

Technical Markcut CLI verification is the producing Agent's responsibility,
not a separate reviewer Task.
