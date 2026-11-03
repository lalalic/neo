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


## P0 publication authorization boundary (CHANGES_REQUESTED revision)

Only the **Content Distribution** project decides rights, owner's publication permission, series, account mapping, Safelist, link validity and exact approved video **bytes**. Generic WebHelm TikTok/YouTube Actions do **not** authorize affiliate publication. They accept an explicit platform request, recheck the currently signed-in account, inspect available post inventory and return a submission receipt that remains `submitted_unverified` until a public post is independently verified. Calling WebHelm `post` directly with `confirm_publish:true` is **not** an authorized business workflow.

Use the project-local `scripts/check-publication.mjs` gate only after obtaining **real owner publication permission** and a **separate actual rights verifier**:

1. Keep an exact `release.json` under the canonical private `runs/<dated-run>/` containing a signed `payload`, `signatures.owner` and `signatures.rights_reviewer` (Ed25519). Signed payload includes provider/series, account ID and expected live channel, distinct public-post approval reference and message ID, creative revision, video SHA-256, visibility, link placement, attempted publication ID, dated rights/Safelist/link/profile evidence and SHA-256 of every underlying private document. Owner permission to preview or submit a Safelist does **not** qualify as `action:"public_post"`.
2. Enroll trustworthy, independently controlled **public keys only** in `config/release-trust.json` after verifying their actual owners and rights-verifier roles. This revision deliberately ships with `keys:[]`; no private signing keys are created or committed. A key or signature invented by the agent must never represent user consent. Source evidence documents and any affiliate URL stay private and Git-ignored. Verify official rights and Safelist evidence at source before creating genuine signed attestations; the script validates their hashes, scope and recency but **cannot independently fetch provider websites or prove that a screenshot is truthful**.
3. Run `node scripts/check-publication.mjs --run <canonical-private-run>` for a non-mutating dry validation; only a genuine two-signature approval, current `accounts.md` status **Approved**, supported pilot provider, fresh provider/placement evidence, and actual matching video bytes can pass. `--reserve` repeats validation and atomically writes a private `publication-attempts/<sha256(id)>.json` record **before** any WebHelm action. An existing attempted publication for the same account/creative revision/hash or attempt ID, including one in another Run, blocks new attempts pending **manual** reconciliation. Do not blindly resubmit or merely rename the attempt ID.
4. Only a reserved result yields a generic WebHelm request with `confirm_publish:true`, destination account, revision, attempt ID, visibility and video SHA-256. Stage the **same bytes** on Worknode; rehash the staged bytes there before upload. Do not assume Neo Master absolute paths are valid on Worknode. Preserve the Run attempt record and the returned receipt. A successful Post/Save click is not evidence of public availability.
5. Platform monitors currently inspect at most 30 post rows. A nonempty sample **never** proves the absence of older duplicates; missing `posts` arrays, untrusted source URLs, stale observations, or non-verified empty states stop a generic post rather than assuming zero. Manual inspection of public posts, drafts and all private attempts is required before a new publication can be authorized. No E2E public upload was performed.

For RS Boost, the portal currently shows the two social Safelists as `Pending Update`. The trusted-key registry is empty and no separate public-post approval exists. Therefore **all real releases remain PRIVATE HOLD**. Synthetic signed unit tests use temporary keys, synthetic rights snapshots, simulated approved status and mock media bytes; they do not create real rights, owner consent, or an approved Safelist.

The gate and per-Run ledger are project-local code, **not** a new backend, queue or service. The public repository may contain verifier code and empty public-key configuration, but never keys with signing capability, tracking URLs, licensed clips, receipts or private Run data.
