# Content Distribution Agent Contract

Follow Neo root `AGENTS.md` and this project guide. [graph.mmd](graph.mmd) is the sole normal-stage DAG; do not reproduce its edges. Project agents are in `agents/`, reusable skills are discovered as needed, and Markcut owns video editing. Do not implement another queue, browser runner, affiliate backend or payout service.

## Identity, evidence and privacy

- [accounts.md](accounts.md) is the **only project-level account registry**. It contains verified public social handles/URLs, stable account IDs and as-of RS Boost registration/Safelist status. Check it at start and on cross-campaign reuse; validate live status before externally acting. Reference `target_account_ids` in private campaign plans instead of copying account identities into each Run.
- Neo's Git repository is public. **Never** commit a login email, invitation/referral code, password, cookie, OAuth credential, account-specific tracking link, banking/tax/identity data, private financial exports or licensed video. Those and all run-specific material, owner approvals, timestamps/receipts and media belong in ignored `runs/<YYYY-MM-DD[-campaign]>/`.
- Verify current **per-episode** grants for the exact Advertising Materials, derivative edits, territory, service, channel, required tracking link and Safelist status. A signed-in account or an original-video upload permission does not itself authorize short-drama clipping.
- Treat each state separately: `registered`, `asset_rights_verified`, `tracking_link_issued`, `safelisted`, `posted`, `attributed_order`, `commission_reported`, `payout_received`. Public historical percentages, clicks and redirect tests never establish paid attribution. Unknown rates or payout methods remain `UNVERIFIED`; never fabricate a value.

## Story context and identity

Preserve series synopsis, character roster and relationships only from verified official sources in private `story-context.json` using `contracts/story-context.schema.json`, with source kind, URL and timestamp. Distinguish a documented API from browser-extracted data. Derive each `speaker_XX` from original episode audio, and map it to a named character only with corroborating scene/identity evidence; keep uncertain matches unresolved. Plot descriptions are not speaker diarization, and story metadata does not grant clipping or dubbing rights.

## Stage gates

- **Rights:** Current specific material/channel permissions must be evidenced before production. If uncertain, hold that creative/channel. A missing fee percentage does **not** prohibit private previews, but blocks assertions about projected revenue.
- **Production and review:** Use Markcut `video.md` in the canonical private Run. Verify the actual rendered video **and sound**, accurate source and truthful hooks/CTA. Human preview approval of the *specific revision* is **required** before labeling it approved; if unavailable, remain `previewed` (not `approved`). Keep evidence under the Run.
- **Pre-release:** Registration consent, channel Safelist filing and creative approval are **not** permission to post. Obtain distinct explicit owner approval tied to video revision, destination account (from `accounts.md`), exact platform/link placement and valid current rights. An owner authorization to update Safelist permits only the indicated account filing.
- **Release:** Before invoking any generic WebHelm post Action, execute the project-local signed [publication gate](scripts/check-publication.mjs) against canonical private Run evidence, verify actual video SHA-256/rights/owner/account/Safelist/link and reserve the attempt. If trust keys or official source evidence are missing, HOLD. Act only within the approved scope and after checking channel Safelist requirements. Preserve the public URL and real visibility proof. An ambiguous click/timeout is not proof of publication; check for an existing post before any retry.
- **Measurement:** Record actual views, clicks, qualifying installs/orders, attributed earnings and cash payout separately, with dated source/currency/attribution window. `0` and `unavailable` are different.

An Agent who finds a defect revises the smallest owning artifact and re-requests preview approval where changed. Project Graph nodes do not automatically create persistent Tasks; external orchestration owns routing and lifecycle.

## Providers

Use official links in [config/providers.json](config/providers.json), but keep specific episode URLs and link tokens in Run evidence. RS Boost is the first pilot provider; its active account and Safelist evidence are in [accounts.md](accounts.md). ReelTree needs an actual agreement, verified Canada eligibility and platform permissions; Dream CPS remains unverified. Payhip original products are a separate campaign type, not evidence of short-drama rights.
