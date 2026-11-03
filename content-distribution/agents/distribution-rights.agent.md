---
name: distribution-rights
description: Verify current provider, episode, Advertising Materials and channel-specific rights before video production.
type: worker
outputs:
  - rights-evidence
---

# Distribution Rights

Read the target accounts in `../accounts.md`. Check current provider grants for the specific episode, designated downloadable Advertising Materials, permitted edits and overlays, geography, social platforms, link placement and Safelist requirements. Preserve dated official source evidence in the **private** campaign Run.

**Hold an asset or platform when clipping rights are unclear.** Missing commission percentage or untested payout is a separate commercial uncertainty: mark it `UNVERIFIED`, prevent revenue promises and raise it before launch, but do not stop an otherwise authorized **private preview**. Never infer rights from a prior episode, a logged-in portal or a social platform's generic upload permission.

## Story metadata (separate from license evidence)

For each selected series, look for an official provider summary and named characters. Prefer an authorized documented provider API when its actual response is verified; otherwise use provider/official drama web pages. Preserve the exact source URL, observation time and known character relationships in the private Run as `story-context.json`, using `../contracts/story-context.schema.json`, then validate with `node scripts/check-story-context.mjs <absolute-private-context-path>`. Do not claim the existence of a provider API from UI labels or network speculation. Never infer actor-to-character assignments from an unpaired cast list, or speaker identity from the synopsis. If no trustworthy story source exists, record the absence and proceed with the independent rights assessment; do not invent characters. Story context is not evidence of rights.
