---
name: browser-platforms
description: "Reusable, verified browser automation assets organized by external platform. When Browser Harness proves a reusable platform flow, capture and maintain that verified flow here instead of leaving it as one-off automation."
requires:
  skills:
    - browser-harness
---

# browser-platforms

This Neo convention organizes platform-specific browser flows above
`browser-harness` and below higher-level agents. It does not reimplement
generic browser interaction.

Before executing any platform flow, load and follow `browser-harness`. If
`browser-harness` is unavailable, this skill is unavailable; do not fall back
to another browser mechanism.

Platform assets live under `platforms/<platform-id>/` and record their
maturity, evidence, URL patterns, side effects, and authentication notes.
Never store cookies, tokens, passwords, or machine-local browser state here.

## Verification-to-asset rule

Browser Harness exploration is allowed to start as one-off work, but a reusable
platform flow is not considered fully learned when the browser interaction
merely succeeds once. After Browser Harness proves a platform flow that is
likely to be reused, capture that knowledge in this skill.

Use this lifecycle:

`Browser Harness exploration -> verified platform behavior -> browser-platforms asset`

For every reusable verified flow:

- first check whether the platform/flow already exists here;
- if it exists, update the canonical asset and its verification evidence rather
  than creating a second implementation elsewhere;
- if it does not exist, add it under `platforms/<platform-id>/` using the
  platform asset contract;
- promote only reusable browser/platform mechanics such as navigation,
  selectors, DOM/AX/CDP interaction, uploads, status/detail-page handling, and
  verification primitives;
- keep product/domain orchestration in the calling skill or agent;
- update `manifest.yaml` maturity/evidence and `last_verified` when the flow has
  actually been verified;
- never capture credentials, cookies, tokens, authenticated session state, or
  machine-local runtime state.

A failed or exploratory attempt does not become a canonical asset. A known
canonical flow should be reused and repaired here instead of being independently
reimplemented by each caller.

Migrated platform mechanics currently include XHS, WeChat Channels, TikTok,
and YouTube. Their `browser-harness/` directories are canonical; `post`
contains only publishing-domain orchestration and points to those assets.

`requires.skills` is a Neo discovery convention enforced by
`skills/xchat-orchestrator/scripts/list-xchat-skills`; it is not claimed to be
a universal Agent Skills standard.
