# Content Distribution Agent Contract

Follow Neo root `AGENTS.md` and this project guide. [graph.mmd](graph.mmd) is the sole normal-stage DAG; do not reproduce its edges. Project agents are in `agents/`, reusable skills are discovered as needed, and Markcut owns video editing. Do not implement another queue, browser runner, affiliate backend or payout service.

## Identity, evidence and privacy

- [accounts.md](accounts.md) is the **only project-level account registry**. It contains verified public social handles/URLs, stable account IDs and as-of RS Boost registration/Safelist status. Check it at start and on cross-campaign reuse; validate live status before externally acting. Reference `target_account_ids` in private campaign plans instead of copying account identities into each Run.
- Neo's Git repository is public. **Never** commit a login email, invitation/referral code, password, cookie, OAuth credential, account-specific tracking link, banking/tax/identity data, private financial exports or licensed video. Those and all run-specific material, owner approvals, timestamps/receipts and media belong in ignored `runs/<YYYY-MM-DD[-campaign]>/`.
- RS Boost grants Campaign-level use of provider-supplied Advertising Materials for ordinary cuts, rearrangement and combinations. Do not require per-video approval for those edits. Confirm the original was downloaded from the licensed Content Hub; distinct consent remains necessary for restricted re-dubbing, narration and misleading changes.
- Treat each state separately: `registered`, `asset_rights_verified`, `tracking_link_issued`, `safelisted`, `posted`, `attributed_order`, `commission_reported`, `payout_received`. Public historical percentages, clicks and redirect tests never establish paid attribution. Unknown rates or payout methods remain `UNVERIFIED`; never fabricate a value.

## Original-source acquisition invariant

For every campaign, retain the complete, licensed **provider-downloaded Episode original** under the canonical private Run `assets/`. Do not overwrite or use a rendered Markcut preview/variant as the initial Vision, Video Use, transcription or diarization input. Save immutable SHA-256, bytes, duration, source URL and episode number in `evidence/original-source.json`; record its `original_source_path` in `campaign.json`. Execute `node scripts/check-original-source.mjs --run <absolute-run>` before primary video understanding, and use only the validated `source_path`; use `--analysis-input` to reject a substituted preview path. Missing/changed originals HOLD analysis and production until the official licensed material is recovered. The authorized Content Hub download is distinct from public ReelShort viewing and does not expand the promotion license beyond its permitted edits.

## Speech → named dialogue → Vision

Preserve the source-backed synopsis, characters and relationships in private `evidence/story-context.json`; distinguish provider API from official-web observations. After source validation, run Video Use on the **complete original** to get word timestamps and `speaker_N` IDs; export canonical `analysis/speech/speaker-id.vtt` and `boundaries.json` from the returned Scribe JSON. One `distribution-speaker-resolver` Agent infers character names using this VTT and the available plot/relationships, producing `analysis/speech/speaker-name.vtt` by changing **only** WebVTT voice annotations. Unknown names stay as their original speaker IDs. The `scripts/speaker-vtt.mjs validate` gate rejects modified timestamps, dialogue or inconsistent names.

Markcut Vision consumes the complete original plus the resolved VTT; Producer receives Vision evidence and raw speech boundaries and owns all editorial decisions. Do not run another STT or create a separate character database, speaker map or Video Use editing/EDL flow. Here `speaker-name.vtt` is WebVTT subtitles; Markcut's `--vtt` means video-to-text and is unrelated. Inferred names are not proven identities; story context grants no dubbing rights.

## Stage gates

- **Rights:** Record the applicable provider terms and authentic licensed Campaign materials once. Reuse within scope; hold only an uncovered source or special edit. Missing CPS percentages remain `UNVERIFIED`, not private-production blockers.
- **Production and review:** Markcut `video.md` stays in the canonical Run; verify rendered video, sound, truthful hook and CTA. Automated QA may label `qa_passed` without repeated human preview approval. Record optional user feedback.
- **Pre-release:** Obtain a distinct, explicit owner **Campaign** publication authorization for series, accounts, allowed edits, visibility and link placements once. Safelist `Pending Update` records uncertain monetization eligibility; it is not an invented per-video provider review. A preview or Safelist submission does not authorize public posting.
- **Release:** Use the project-local [publication gate](scripts/check-publication.mjs) to check once-signed Campaign permission, true rendered-video SHA-256, the linked account, allowed edit and tracking link, then reserve each attempt. If owner authorization is absent, HOLD. Full post/draft inventory still belongs to the platform Action; never bypass its hold or retry ambiguous submissions.
- **Measurement:** Record actual views, clicks, qualifying installs/orders, attributed earnings and cash payout separately, with dated source/currency/attribution window. `0` and `unavailable` are different.

An Agent who finds a defect revises the smallest owning artifact, repeats QA and requests optional human feedback when applicable. Project Graph nodes do not automatically create persistent Tasks; external orchestration owns routing and lifecycle.

## Providers

Use official links in [config/providers.json](config/providers.json), but keep specific episode URLs and link tokens in Run evidence. RS Boost is the first pilot provider; its active account and Safelist evidence are in [accounts.md](accounts.md). ReelTree needs an actual agreement, verified Canada eligibility and platform permissions; Dream CPS remains unverified. Payhip original products are a separate campaign type, not evidence of short-drama rights.
