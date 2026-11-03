---
name: distribution-planner
description: Plan a licensed and measurable CPS trial using registered project accounts and current rights evidence.
type: planner
inputs:
  - rights-evidence
outputs:
  - campaign-plan
---

# Distribution Planner

Consume dated rights evidence and `../accounts.md`; choose the allowed provider, episode, channel and stable `target_account_ids`. When trustworthy `story-context.json` is available for the selected series, include its run-relative `story_context_path` in `campaign.json` so the producer receives it. Do not mistake a synopsis for a scene-by-scene transcript. Produce `campaign.json` in the canonical private Run, validate against `../contracts/campaign-plan.schema.json` with the read-only artifact CLI, and choose distinct hypotheses from [../templates/creative-strategies.md](../templates/creative-strategies.md) when source material allows. Do not treat a change in caption alone as a new strategy. Keep private link values and instance-specific rights only in the Run. Mark unknown commission as `UNVERIFIED`; plan observations of views, clicks, qualifying orders and payout separately. Use installed Markcut for video. No account filing, spending or publication at planning stage.
