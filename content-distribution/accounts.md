# Accounts and Creator Safelist

This is the **project-wide registry** for reusable provider and distribution-channel accounts. It contains only non-secret account identifiers and observed status. Git history is public; do **not** add login emails, passwords, OAuth credentials, cookies, private tracking/referral codes, banking, tax or identity documents.

The two Safelist statuses below were rechecked in the authenticated RS Boost Creator Safelist on **2026-11-03**. Other facts retain their separately dated observations. Recheck live status before any external action.

## Affiliate provider account

**RS Boost — ReelShort (New Leaf Publishing, Inc.)**
- Portal: https://cps.reelshort.com/
- Access: registered with Google Sign In; authenticated Content Hub and earnings pages were verified in the 2026-11-02 E2E.
- Registration: official RS Boost support confirmed that an individual resident in Canada may join with no fixed registration/subscription cost (support response reported 2026-10-26). An official invitation was used during signup; do not reuse, disclose or change any referral binding.
- Wallet and earnings: on 2026-11-03, the authenticated **Yesterday** earnings view showed $0.00 estimated earnings and 0 orders; the current-month estimate also showed $0.00. These are dated dashboard observations, not an all-time order audit. The provider displayed a **US$50 withdrawal minimum** and a monthly 12th–20th withdrawal window on 2026-11-02; payout setup and receipt were **not tested**.
- Episode-specific CPS percentage, real order attribution and successful payout remain **UNVERIFIED**. Account registration does not establish conversion or payout.
- Official agreement: https://cps.reelshort.com/user/agreement
- Earnings: https://cps.reelshort.com/my-earnings

## Approved distribution-account identities

| Stable ID for campaign references | Service | Confirmed account | Public profile | RS Boost app | Safelist filing | Last observed |
| --- | --- | --- | --- | --- | --- | --- |
| `tiktok-primary` | TikTok | `@lalalic001` | https://www.tiktok.com/@lalalic001 | ReelShort(Drama) | **Pending Update** | 2026-11-03 |
| `youtube-primary` | YouTube Shorts | `@lalalic7595` (channel **lalalic**) | https://www.youtube.com/@lalalic7595 | ReelShort(Drama) | **Pending Update** | 2026-11-03 |

YouTube's public channel ID is `UCOoJX2s21KrOcRE0B46vx6g`; its Handle URL above, not `/channel/<id>`, is required by the RS Boost Safelist form.

### Safelist submission audit

The owner explicitly authorized account submission on 2026-11-02; **no permission to publish** was granted. The authenticated TikTok Studio showed `@lalalic001` and YouTube Studio → Customization → Profile showed `@lalalic7595`. The RS Boost **Creator Safelist** accepted TikTok as username `lalalic001` (not a full link) and YouTube as `https://www.youtube.com/@lalalic7595`. A read-only authenticated Creator Safelist dialog inspection on 2026-11-03 independently found both original rows still present, each marked `Pending Update`; nothing was resubmitted or changed.

This verifies account *submission and persisted pending status*, **not** completion of provider review, video rights, per-video tracking, or public publication. Before posting, re-check status, provider-specific requirements, current rights, target account and correctly matched promotional link.

## WebHelm execution node (2026-11-02 baseline; 2026-11-03 read-only recheck)

- **Worknode is the intended development and publishing/monitoring execution node**. TikTok Studio is now authenticated on Worknode as `lalalic001`: the `tiktok inspect` Action returned `ready`, with an Upload button present (2026-11-02). This verifies the existing upload control, not an end-to-end publication.
- Worknode YouTube Studio initially showed a transient Chrome error, but subsequently loaded the expected channel and its Upload/Create controls. Read-only `youtube inspect` returned `ready` for the correct channel. No actual upload has been tested; the Shorts list showed no observed video rows.
- Worknode `tiktok monitor` now successfully reads an **existing unrelated public post** and its visible views/likes/comments (107/1/0 on 2026-11-02); the Comments page explicitly reported no comments. This validates TikTok read-only monitoring for the observed state, but is not an RS Boost conversion or a test of nonempty comment parsing.
- The migrated TikTok and YouTube WebHelm `post` Actions have not passed a real upload E2E. The read-only `inspect` and `monitor` Actions and explicit `confirm_publish` guard are installed on Worknode. Do not claim that public publishing or YouTube nonempty analytics is verified until a separately authorized live post is observed.

On 2026-11-03 the Worknode `inspect` Actions again returned `ready` for the same TikTok handle and YouTube channel ID. TikTok `monitor` returned one unrelated historical post with 107/1/0 views/likes/comments. YouTube Shorts `monitor` returned `unverified` with no parsed post rows. Neither Action verified a complete historical inventory, and both still lack independent draft/upload-state evidence, so automated posting remains blocked. Reviewed WebHelm Actions were reconciled with the concurrent RS Boost metadata commit, passed 54/54 targeted tests, and were synchronized to the Actions repository as `53dd643`; code delivery is not social-post authorization.

## Research accounts (not publication accounts)

- **Xiaohongshu / Rednote — research-only:** Worknode WebHelm managed Chrome showed the signed-in public profile [李藕](https://www.xiaohongshu.com/user/profile/60d93722000000000101ff82) and authenticated XHS search on 2026-11-02. The account was used for **read-only strategy research**; XHS is **not** a RS Boost Safelist-approved distribution account and no XHS public posting authorization exists. Login is time-sensitive; re-check before future reads. The earlier DEVICE_LIMIT state no longer blocked the later session. Do not place login tokens, cookies or private saved-note contents in Git.

## Ownership and change control

- The accounts and their Safelist history belong **here**, not under an episode or campaign Run. Use the stable IDs above in `runs/.../campaign.json` to refer to accounts without copying the registry.
- An observed account rename, status change or newly approved channel should be updated here with its observation date and source. An account change is not an approval to publish.
- Each private Run owns its own episode/asset grants, creative revision, tracking URL, release approval and per-post evidence. Do not move those into this public registry.
- Never publish, alter public account profiles, register another channel, or provide financial/identity information without the owner's separate authorization.
