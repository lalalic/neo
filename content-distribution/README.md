# Content Distribution

Neo Project for licensed short-video CPS distribution. **RS Boost** is the first provider; ReelTree and others remain research candidates until independently verified. The goal is measured lawful conversions, not an assertion of revenue.

The sole normal-stage workflow is [graph.mmd](graph.mmd). [AGENTS.md](AGENTS.md) owns project-wide policy and approval gates; project-specific roles are in `agents/`. Reuse the installed Markcut Skill for editing and preview, and WebHelm for authorized browser actions. The project does not implement its own task queue or publishing backend.

The [commercial release and attribution gates](docs/commercial-readiness.md) define the independent owner approval, licensed asset, channel link, publication receipt, measurement and payout evidence chain. The [attribution snapshot schema](contracts/attribution-snapshot.schema.json) records dated metrics without storing private links in Git.

The [creative strategy library](templates/creative-strategies.md) gives grounded hook selection and compliant test variants. The [monitoring runbook](docs/monitoring.md) documents Worknode platform readiness, publication safeguards and feedback data capture.

## Where information belongs

| Location | Responsibility |
| --- | --- |
| [accounts.md](accounts.md) | **Single source of truth** for ongoing RS Boost registration status and public TikTok/YouTube identities, URLs, Safelist filing and observed status |
| [config/providers.json](config/providers.json) | Official provider portals and research status, independent of any individual drama |
| [contracts/campaign-plan.schema.json](contracts/campaign-plan.schema.json) | Reusable campaign handoff format; campaign references account IDs and optional private story context |
| [contracts/story-context.schema.json](contracts/story-context.schema.json) | Sourced synopsis/characters and evidence-bound speaker identities for the original episode |
| `runs/<YYYY-MM-DD[-campaign]>/` | **Ignored, private** episode licenses, downloaded media, Markcut videos/previews, private referral URLs, campaign plans, revision approvals, publication and conversion receipts |

The Git repository is public. Only deliberately public channel handles/URLs and sanitized provider account status belong in `accounts.md`. Never commit credentials, signup email, tracking tokens, personal/bank/tax details, licensed clips, user media or per-campaign earnings.

## Operating a campaign

1. Resolve with `neo project resolve content-distribution`; check [accounts.md](accounts.md) and current provider terms. Do not reuse an episode link simply because it appears in an older Run.
2. Create a private dated Run in this **canonical** project directory (never in a temporary worktree). Select verified provider assets, channel/account IDs and exact permissions for the episode. Save official synopsis/character relationships in private `story-context.json` if available (prefer verified provider API; otherwise official drama webpage); distinguish story facts from individual audio speaker identity. Preserve date-stamped rights evidence.
3. Validate `campaign.json` with the [campaign schema](contracts/campaign-plan.schema.json). Produce private variants using Markcut `video.md` and verify/render them. Save review evidence for each revision.
4. Obtain the owner's approval of the **exact video revision, target social account, post destination and tracking-link placement** before public publishing. Creator Safelist submission and posting are separate actions, each requiring their own authorization; an existing registration or Safelist record is not a post approval.
5. After authorization, check public post receipts, impressions, clicks, qualified purchases, reported CPS commission and actual payout separately. A working redirect or dashboard registration is not a qualifying order.

No persistent service or `neo-project` lifecycle entrypoint is necessary for this agent-only project. The Graph specifies roles, not an automatically scheduled Job; use existing orchestration tools only when explicitly requested.

Release entrypoint (PRIVATE HOLD until genuinely signed, current evidence exists): `node scripts/check-publication.mjs --run <canonical-private-run>`; the `--reserve` flag additionally records a non-repeatable private attempt. See [business authorization boundary](docs/commercial-readiness.md). Generic WebHelm post Actions do not independently authorize RS Boost or any other commercial campaign.
