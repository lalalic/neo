# Commercial release and attribution gates

Scope: RS Boost pilot. Account identity and Safelist records belong only in [accounts.md](../accounts.md). Private links, permission evidence, owner approvals, publication attempts, dated metrics and receipts belong only under ignored canonical `runs/`. Do not install a separate backend, queue or database.

## Source-backed provider requirements (checked 2026-11-02)

Official [RS Boost terms](https://cps.reelshort.com/user/agreement) (effective 2025-10-23), sections III-IV:

- Editing/cropping/rearrangement of supplied Advertising Materials is generally permitted within scope, but distorting the underlying Work, misleading edits, re-dubbing, narrating or spoiling without prior consent, modifying marks and separating Advertising Materials from approved promotion links are restricted.
- Attribution requires a **new user** making the first install **and visit** via a qualifying link, or **re-engagement** after thirty days without in-app activity via the qualifying link. Thirty days is a re-engagement definition, **not an independently verified click/cookie attribution window**.
- CPS is calculated on attributed users' qualifying spending on Works, excluding in-app ad revenue, gifts and chargebacks. Chargebacks are deducted from the next month's CPS report. Reports are monthly. The applicable percentage is defined by series/provider pages, not the general terms.
- For **Done Being His Backup: I Chose My Stepbrother**, the authenticated series page on 2026-11-02 showed 28 episodes and first five free, App Promotion Link, Content Promotion Link, and Content Referral Code. No numerical series CPS percentage was shown in the observed view. Record **UNVERIFIED**, not 0%.
- A single synthetic, authenticated-page Content Promotion Link navigation reached the ReelShort listing on `apps.apple.com` via the observed `reelslink.com` link. This verifies browser redirection only, not iOS first launch, deep-link handoff or purchase attribution. Do not substitute the public series detail URL for the private Content Promotion Link.
- The signed-in Earnings page showed $0.00 and 0 orders at this checkpoint. The account reported a US$50 minimum and 12th–20th monthly withdrawal window earlier that day, but **payout capability, bank setup, currency settlement, taxes and bank receipt remain untested**. Do not begin payout setup or withdrawal.
- The two Creator Safelist rows were independently re-read and remained **Pending Update**. Filed != accepted. No video was approved for publication.

## Clickable social destination gate

- **YouTube Shorts:** YouTube's [link guide](https://support.google.com/youtube/answer/13748639) says ordinary Shorts description and comment URLs are **not clickable**. Channel profile links are clickable (up to 14). The Worknode Studio Profile screen showed the `Links → Add link` control but no configured external links in the observed section. The owner must approve any profile change separately. External brand-deal links are a different, conditional program and are not assumed available.
- **TikTok:** the [TikTok account guide](https://support.tiktok.com/en/using-tiktok/growing-your-audience/switching-to-a-creator-or-business-account) distinguishes personal accounts (website link at 1,000+ followers) from business accounts (website field). The Worknode public profile returned `Please wait...`, so this account's actual website-link eligibility, account type and visible link are **UNVERIFIED**; do not claim a clickable TikTok bio exists.
- A working URL redirect is not proof that a viewer click will survive an in-app browser, store install, first app visit, campaign attribution, orders or cash settlement. Preserve the exact private Content Promotion Link in the Run, validate its landing route and account ownership, and record each observed step separately. Never store the tracking URL in Git.

## Minimum operator state transitions

| State | Required distinct evidence | On failure |
| --- | --- | --- |
| Rights cleared | Current exact episode/material grants, channel, territory, edit scope, relevant link | PRIVATE HOLD |
| Safelist approved | Authenticated provider row **approved**, not filed/pending | PRIVATE HOLD |
| Link mapped | Exact approved series Content Promotion Link and approved clickable placement | HOLD: no promise of conversion |
| Creative revision approved | Human review evidence for exact video and audio content hash/revision | PRIVATE HOLD |
| Posting permitted | Owner's **separate** approval for revision, account, visibility and link placement | No upload |
| Submitted | Unique attempt ID, request, upload evidence and click result | `submitted_unverified`; no blind retry |
| Published | Observable post ID, URL, visibility and timestamp on correct channel | Reconcile manually; never assert posted |
| Measured | Post ID + dated observed platform metrics; missing metrics are null/unavailable | Mark unavailable |
| Attributed | Provider qualifying orders and commission with reporting date and source | Remain UNVERIFIED, not zero |
| Paid | Distinct settlement, withdrawal approval and actual receipt | NOT_RUN without explicit approval |

Use [attribution snapshot schema](../contracts/attribution-snapshot.schema.json) for each dated private Run record. A snapshot links **creative revision × account × post ID × private affiliate-link reference × platform observations × provider observations**. A verified empty list of posts is not an observed zero for affiliate orders. There is no one-to-one post-to-order attribution unless the provider supplies a matching tracking dimension; otherwise mark per-post attribution unavailable and keep aggregate earnings separate.

Manual recovery: if an upload, browser navigation, Post/Save click or confirmation times out, first inspect the destination channel's existing posts and drafts for a matching creative/revision before attempting any new upload. If unresolved, hold. A repeated `publication_attempt_id` is not a safe idempotency key without persistent server-side enforcement; never let a caller reissue the same attempt automatically.

## Provider support questions (do not send without separate approval)

Ask RS Boost support for the **current series-specific commission rate and bonuses**, exact eligible purchase/order definition, last-click/cross-device/cookie/install attribution and competing-link rules, cancellation/refund/chargeback timing, monthly reporting and dispute procedure, Safelist approval meaning/ETA, and the US$50 threshold, 12th–20th window, payout method and currency. The support contact is shown on the official RS Boost portal. Do not disclose account login, private affiliate URL or payment details.
