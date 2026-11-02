# Content Distribution Agent Contract

Read the Neo root `AGENTS.md` and this project guide. [graph.mmd](graph.mmd) is the **only** normal stage DAG; do not duplicate its topology in task plans or agent instructions. Resolve project agents under `agents/` and reusable behavior through installed Skills, especially `markcut` for video. No second queue, runner, affiliate backend or advertising service belongs here.

## Evidence and privacy

- Each provider, episode and channel needs **current** terms and precise grants: source material, editing, overlays/narration, geographic territory, platform, term, attribution link and safelist requirements. The permission to upload an original video does not grant rights to redistribute a drama clip. If rights are ambiguous, hold that channel/creative and ask for authoritative clarification.
- Promotional payout rates, affiliate dashboards, bank options and Canadian eligibility are evidence of their own scope and date, not guaranteed earnings. Separate `account_registered`, `asset_licensed`, `link_issued`, `posted`, `tracked_conversion`, `commission_reported` and `payout_received` in private evidence. Never infer a later state from an earlier one.
- Use the current authenticated provider's terms where available, or official dated documents with source URLs. Do not treat a historical Douyin video or third-party recommendation as contract authority. Report an unknown as `BLOCKED`/`UNVERIFIED`, not a fabricated number.
- All account identifiers, cookies, referral links, downloaded licensed clips, raw media, approval evidence, campaign plans, channel metrics and payouts belong in private `runs/<YYYY-MM-DD[-campaign]>/`. No credentials or financial details in tracked files, ChatGPT instructions, public artifacts or logs. Do not access another project's `runs/`.

## Stage acceptance and owner gates

- **Rights gate:** A target episode and its designated materials/platforms/regions have verifiable current permissions; no unapproved sources or third-party invites. Record the actual licensed asset and constraints for this run.
- **Creative gate:** Each preview uses an instantiated Markcut `video.md` under the current run, from authorized material. Verify and inspect real playback, voice, soundtrack and CTA. Use separate traceable links where allowed; do not promise attribution from an untested redirect.
- **Pre-release gate (required owner approval):** The owner reviews the *specific* creative revision, source license and exact platform/account/destination, tracking link, safelist status and intended release. An earlier preview approval or permission to register does **not** authorize safelist submission, public posting, spending, contract acceptance beyond standard registration, or sensitive tax/bank/identity disclosures.
- **Release gate:** Only after documented owner permission and platform/safelist requirements are met may distribution take external action. Preserve posting URL/receipt and evidence of actual visibility. No silent retries on uncertain submissions: check for a possible existing post first.
- **Measurement gate:** Track actual impressions/views, link clicks, qualifying conversions, attributed commission and cash receipt distinctly, with date/currency/source and missing data labeled. A $0 or unavailable metric is not a failed technical publication; it is not revenue.

A review finding returns to the smallest owning stage; changed creatives require a fresh revision-bound approval before posting. Task and revision lifecycle, if later delegated, belong to the existing orchestration tools rather than this project.

## Initial provider

RS Boost is the first intended integration, but stored research is not a current authenticated snapshot. Read the source pointers in `config/providers.json` and inspect actual backend rights and payout terms before selecting a campaign. ReelTree/Forest Dream requires current agreement and Canadian/cross-border distribution evidence; Dream CPS remains unverified. The Payhip original digital-goods avenue is a *separate campaign type*, not a reason to assume short-drama licensing.
