# Commercial readiness and campaign release

RS Boost is a promotion program. Its [official agreement](https://cps.reelshort.com/user/agreement), effective October 23, 2025, grants a reusable right to distribute and ordinarily edit its **provided Advertising Materials** to promote the works. It does **not** require separate RS Boost review of every clip. This grant is limited to the provider-supplied assets; it is not a blanket license to rip public streams. Unapproved re-dubbing, narrating, misleading modifications, watermark removal and use without promotional links remain restricted under section III.

## Authorization model

- **RS Boost rights once per Campaign:** record the actual licensed materials, series and scope in a private Run. Routine crops, cuts, captions, reorderings and compilations under those terms do not need per-video rights requests. Obtain provider consent if the actual edit falls under the agreement's special-modification restrictions.
- **One owner publication decision per Campaign:** the owner may authorize a specified series, destination accounts, visibility, edit types and tracking-link placements. Subsequent eligible clips do not each require another owner signature or human preview.
- **One owner signature for that Campaign permission:** the public `config/release-trust.json` file enrolls only an owner-controlled **public** Ed25519 key. The owner signs a single private `campaign-authorization.json`; do not create or impersonate owner signatures on an agent's initiative. There is **no separate rights-reviewer signature**.
- **Account Safelist is not per-video review:** status `Pending Update` is a commercial attribution/eligibility warning, not an automatic contractual publishing ban. Account identity and filing are still checked. No one should claim earnings or approval based on the pending status.
- **Link placement:** keep the actual private campaign promotion link linked to the series/account and record intended placement. A clickable profile link is not a hard prerequisite of the code gate. Whether viewers can click through a Shorts description, comment or TikTok bio is a separate real conversion-readiness issue.
- **Technical release safety is independent:** every attempted upload needs the actual rendered file hash, correct live destination, unique reserved attempt and reconciliation of prior attempts. Never bypass a platform Action because it lacks complete posts/drafts/failed-upload inventory.

No actual owner Campaign publication authorization has been given for the existing historical Runs. The user's permission to simplify this project is **not** permission to upload or post.

## Private release input

Place both files in the canonical ignored `runs/<dated-campaign>/` directory:

- `campaign-authorization.json`: `schema: "content-distribution.campaign-authorization.v1"`, `payload` with `action: "campaign_publication"`, `campaign_id`, `provider_id`, `series_id`, `account_ids`, `allowed_visibilities`, `allowed_edit_types`, `allowed_link_placements`, owner `source_url`, `source_message_id`, `issued_at` and optional `expires_at`; plus owner-controlled Ed25519 `signature` over the canonical payload. One Campaign signature can be reused for multiple eligible revisions.
- `release.json`: `schema: "content-distribution.release-envelope.v2"`, `authorization_path: "campaign-authorization.json"`, `payload` with `schema: "content-distribution.release.v2"`, campaign/series, selected creative ID/path, actual MP4 SHA-256, target account/visibility/text, edit type (standard clip or consent-backed narration), unique attempt ID, rights source and hashed document, and the private tracked link and placement. Each release file is **not** separately signed. The gate verifies that it stays inside the signed Campaign scope.

Execution: run `node scripts/check-publication.mjs --run <absolute-canonical-run>` to dry-check without upload; `--reserve` creates a persistent, non-repeatable attempt record before any WebHelm upload. Missing genuine owner Campaign authorization or missing private link/rights evidence yields `PRIVATE HOLD`. Unit-test signatures are synthetic and do not authorize actual publishing. The generic WebHelm post Action requires its own platform intent confirmation, validates the staged bytes again and returns `submitted_unverified`, **not** a public-post URL.

## Operational checks

| Stage | Evidence | When incomplete |
| --- | --- | --- |
| Original source | Provider-downloaded full episode, immutable SHA-256/size/duration and current campaign rights | HOLD analysis of unverified input |
| Story and creative | Sourced plot/speakers; Markcut Markdown, actual rendered picture/sound QA | Revise or remain `previewed` |
| Campaign publication | Owner-signed scope and permissions applicable to the chosen platform/edit | PRIVATE HOLD |
| Safelist | Correct filed account and currently observed state | Pending = monetization warning; rejected/unlisted = HOLD |
| Tracking | Series-matched private promotion link, disclosed placement; clickability observed separately | HOLD if link absent; warn if clickability unverified |
| Attempt | Accurate MP4 hash; unique persistent reservation; no unresolved duplicates | HOLD or manual reconciliation |
| Uploaded/published | Real destination and visibility proof, not a click receipt | `submitted_unverified` until observed |
| Attribution/payout | Dated views, clicks, qualifying orders and CPS, with distinct settlement and actual bank receipt evidence | `UNVERIFIED`, not invented zero |

The Worknode TikTok/YouTube monitors only sample a small number of posts and do not independently prove all historical drafts, scheduled items, failed uploads, hidden items and duplicate attempts. A repeated attempt ID is not a safe idempotency key without real state reconciliation. Do not fabricate inventory or automatically retry. Follow the Worknode Actions `platforms/MANUAL_RECONCILIATION.md` and its read-only monitoring when needed.

## Current program facts

The account identities and dated Safelist observations live only in [accounts.md](../accounts.md). The provider's 30-day inactivity threshold describes **re-engagement**, not the full click/cookie attribution window. Qualified CPS depends on attributed purchases in the promoted Works; reported orders and cash payout are different from views, redirect tests and registration. The authenticated target drama details did not establish a numeric series CPS rate. Record all such uncertain values as `UNVERIFIED`.

[YouTube Shorts guidance](https://support.google.com/youtube/answer/13748639) says ordinary Shorts description/comment URLs are not clickable. [TikTok account guidance](https://support.tiktok.com/en/using-tiktok/growing-your-audience/switching-to-a-creator-or-business-account) makes external profile-link features conditional. These are real conversion constraints, but not reasons to require a fresh owner's video approval.

The private, unsent support draft under the 2026-11-02 commercial review can be used to clarify CPS rate, attribution window, Safelist earnings eligibility and special editing permission. Do not send it, alter public profiles, spend, or access bank/tax/withdrawal workflows without separate authorization.
