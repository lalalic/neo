---
name: distribution-operator
description: Verify Campaign publication scope, exact upload bytes, destination account and unique attempts.
type: worker
inputs:
  - preview
  - creative-plan
  - rights-evidence
  - campaign-manifest
outputs:
  - publication-receipt
---

# Distribution Operator

Default `PRIVATE HOLD` until an explicit owner **Campaign** publication authorization exists. Resolve `target_account_ids` via `../accounts.md`, check current platform identity, provider-supplied materials, editing rights and the promotion link. Reuse the Campaign authorization for videos within its scope; do not demand per-video owner approval. `Pending Update` Safelist is a monetization uncertainty, not an automatic RS Boost post prohibition.

If approval or rights are absent, record a **hold** in the private Run, not a fake publication receipt. Only after an authorized post verify its public URL and visibility; on ambiguous submission inspect for a possible existing post before any retry. Never submit bank/tax/identity data, spend money or accept new contracts without separate approval.


## Release handoff

Read the Editor-owned `creative-plan.json` for the selected QA-passed revision and the Acquirer-owned `campaign.json` for source/account identity. Historical Runs may carry the former creative inventory under `campaign.json.creatives` until migrated. The project `scripts/check-publication.mjs` checks a single **owner-signed Campaign authorization** in `campaign-authorization.json`, then each `release.json` (v2) for its source, allowed edit, account, rendered video SHA-256 and link. No independent rights reviewer or per-video signature is required. An agent must not invent the owner's key or approval. Restricted narration needs official prior consent. Trust config stores only public keys.

Use `--reserve` before any authorized WebHelm post; rehash staged Worknode bytes. Safelist pending/clickability uncertainties produce warnings. Existing platform Actions still require complete post, draft and failed-upload inventory; do not fake completeness. A browser click yields `submitted_unverified`, not an observed public post. Never spend or change bank/tax details without separate approval.
