---
name: browser-platforms
description: "Reusable, verified browser automation assets organized by external platform."
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

`requires.skills` is a Neo discovery convention enforced by
`skills/xchat-orchestrator/scripts/list-xchat-skills`; it is not claimed to be
a universal Agent Skills standard.

