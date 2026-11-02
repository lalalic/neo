# Accounts and Creator Safelist

This is the **project-wide registry** for reusable provider and distribution-channel accounts. It contains only non-secret account identifiers and observed status. Git history is public; do **not** add login emails, passwords, OAuth credentials, cookies, private tracking/referral codes, banking, tax or identity documents.

All statuses below were last observed on **2026-11-02**. Check the current authenticated pages before assuming any state remains unchanged.

## Affiliate provider account

**RS Boost — ReelShort (New Leaf Publishing, Inc.)**
- Portal: https://cps.reelshort.com/
- Access: registered with Google Sign In; authenticated Content Hub and earnings pages were verified in the 2026-11-02 E2E.
- Registration: official RS Boost support confirmed that an individual resident in Canada may join with no fixed registration/subscription cost (support response reported 2026-10-26). An official invitation was used during signup; do not reuse, disclose or change any referral binding.
- Wallet and earnings: the dashboard was reported at $0 and 0 orders on 2026-11-02. The provider displayed a **US$50 withdrawal minimum** and a monthly 12th–20th withdrawal window; payout setup and receipt were **not tested**.
- Episode-specific CPS percentage, real order attribution and successful payout remain **UNVERIFIED**. Account registration does not establish conversion or payout.
- Official agreement: https://cps.reelshort.com/user/agreement
- Earnings: https://cps.reelshort.com/my-earnings

## Approved distribution-account identities

| Stable ID for campaign references | Service | Confirmed account | Public profile | RS Boost app | Safelist filing | Last observed |
| --- | --- | --- | --- | --- | --- | --- |
| `tiktok-primary` | TikTok | `@lalalic001` | https://www.tiktok.com/@lalalic001 | ReelShort(Drama) | **Pending Update** | 2026-11-02 |
| `youtube-primary` | YouTube Shorts | `@lalalic7595` (channel **lalalic**) | https://www.youtube.com/@lalalic7595 | ReelShort(Drama) | **Pending Update** | 2026-11-02 |

YouTube's public channel ID is `UCOoJX2s21KrOcRE0B46vx6g`; its Handle URL above, not `/channel/<id>`, is required by the RS Boost Safelist form.

### Safelist submission audit

The owner explicitly authorized account submission on 2026-11-02; **no permission to publish** was granted. The authenticated TikTok Studio showed `@lalalic001` and YouTube Studio → Customization → Profile showed `@lalalic7595`. The RS Boost **Creator Safelist** accepted TikTok as username `lalalic001` (not a full link) and YouTube as `https://www.youtube.com/@lalalic7595`. On reopening the RS Boost page in a new WebHelm session, both records were still present, each marked `Pending Update`.

This verifies account *submission and persisted pending status*, **not** completion of provider review, video rights, per-video tracking, or public publication. Before posting, re-check status, provider-specific requirements, current rights, target account and correctly matched promotional link.

## WebHelm execution node (2026-11-02 check)

- **Worknode is the intended development and publishing/monitoring execution node**. TikTok Studio in Worknode WebHelm redirects to the login page; the authenticated Neo Master browser cannot be assumed to share its cookies.
- Worknode YouTube Studio initially showed a transient Chrome error, but subsequently loaded the expected channel and its Upload/Create controls. Read-only `youtube inspect` returned `ready` for the correct channel. No actual upload has been tested; the Shorts list showed no observed video rows.
- The migrated TikTok and YouTube WebHelm `post` Actions have not passed an authenticated upload E2E. Worknode Actions now include read-only `inspect` and `monitor`, plus an explicit `confirm_publish` safety gate. Source and tests are maintained in the Worknode WebHelm Actions checkout. Do not claim production publishing/feedback monitoring is verified until a real authorized post can be observed.

## Ownership and change control

- The accounts and their Safelist history belong **here**, not under an episode or campaign Run. Use the stable IDs above in `runs/.../campaign.json` to refer to accounts without copying the registry.
- An observed account rename, status change or newly approved channel should be updated here with its observation date and source. An account change is not an approval to publish.
- Each private Run owns its own episode/asset grants, creative revision, tracking URL, release approval and per-post evidence. Do not move those into this public registry.
- Never publish, alter public account profiles, register another channel, or provide financial/identity information without the owner's separate authorization.
