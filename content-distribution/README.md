# Content Distribution

Neo Project for licensed short-video CPS distribution. **RS Boost** is the first provider; ReelTree and others remain research candidates until independently verified. The goal is measured lawful conversions, not an assertion of revenue.

The sole normal-stage workflow is [graph.mmd](graph.mmd). [AGENTS.md](AGENTS.md) owns project-wide policy and approval gates; project-specific roles are in `agents/`. Reuse the installed Markcut Skill for editing and preview, and WebHelm for authorized browser actions. The project does not implement its own task queue or publishing backend.

To explicitly start a Relay-backed run from an HTTPS source reference, use `neo project run --url=https://... --project=content-distribution` (or separate flag values). The URL is private input evidence only; it grants no license and triggers no automatic download or publication. See the [Neo Project Run Contract](../docs/neo-project-run-contract.md) and retain the rights and owner-authorization gates below. The current `graph.mmd` is the only workflow authority; the CLI does not introduce another planner or queue.

The [commercial release and attribution gates](docs/commercial-readiness.md) define reusable owner Campaign authorization, licensed assets, tracked links and separate publication, measurement and payout evidence. The [Artifact Handoff Contract](contracts/artifact-handoffs.md) names run-local deliverables and checks without duplicating the DAG.

The [creative strategy library](templates/creative-strategies.md) guides the Editor in choosing 1–N evidence-backed variants after Vision; it does not prescribe a fixed count.

## Cached-artifact shortcuts

Deterministic project-local `agents/.shortcut/<agent>.agent.mjs` modules expose Relay's `run({ input, runCommand })` interface. They call the **existing** validators and VTT bridge rather than duplicating their logic:

| Agent | Shortcut completes only when | Still requires Worker for |
| --- | --- | --- |
| Acquirer | Existing verified provider original, Campaign manifest, dated rights and sourced story context | Authenticated Content Hub download, new provider rights/metadata collection |
| Transcriber | Hash-bound full-original Video Use `scribe.json` and `scribe-source.json` already exist; derive/reuse canonical VTT and speech boundaries | Actual Scribe API invocation, cloud quota, cross-node media staging |
| Speaker Resolver | Named VTT already exists and passes unchanged-dialogue/timing + official name validation | Guessing character names from story and dialogue |

The shared Visioner shortcut is currently Vlog-run-specific and is not a Content Distribution shortcut. The full 7-role Graph still lacks executable shortcut coverage for Visioner, Editor, Operator and Analyst. Relay checks whole-Graph shortcut coverage first and hands incomplete Graphs to the ordinary Worker pipeline before running any shortcut. These modules can also run on a narrower, intentionally created single-stage Graph Task with complete inputs; they are not a new orchestrator or a replacement for the canonical `graph.mmd`. No shortcut bypasses owner Campaign publication permission or platform inventory checks. The [monitoring runbook](docs/monitoring.md) documents Worknode platform readiness, publication safeguards and feedback data capture.

## Where information belongs

| Location | Responsibility |
| --- | --- |
| [accounts.md](accounts.md) | **Single source of truth** for ongoing RS Boost registration status and public TikTok/YouTube identities, URLs, Safelist filing and observed status |
| [config/providers.json](config/providers.json) | Official provider portals and research status, independent of any individual drama |
| [contracts/campaign-plan.schema.json](contracts/campaign-plan.schema.json) | Acquirer-owned `campaign.json` source/rights/account manifest (legacy filename retained for compatibility) |
| [contracts/creative-plan.schema.json](contracts/creative-plan.schema.json) | Editor-owned `creative-plan.json`: 1–N creative variants, evidence, hypotheses and QA status |
| [contracts/story-context.schema.json](contracts/story-context.schema.json) | Sourced synopsis, characters, aliases and relationships (no required speaker map) |
| [contracts/scribe-source.schema.json](contracts/scribe-source.schema.json) | Raw Scribe output bound to the original MP4's verified source digest for safe VTT shortcut reuse |
| `evidence/original-source.json` in private Run | Full licensed original video path, provenance and immutable digest; never a Preview |
| `runs/<YYYY-MM-DD[-campaign]>/` | **Ignored, private** episode licenses, downloaded media, `campaign.json` manifest, `creative-plan.json`, Markcut videos/previews, private referral URLs, revisions, publication and conversion receipts |

The Git repository is public. Only deliberately public channel handles/URLs and sanitized provider account status belong in `accounts.md`. Never commit credentials, signup email, tracking tokens, personal/bank/tax details, licensed clips, user media or per-campaign earnings.

## Operating a campaign

1. Resolve with `neo project resolve content-distribution`; check [accounts.md](accounts.md) and current provider terms. Do not reuse an episode link simply because it appears in an older Run.
2. Create a private dated Run in this **canonical** project directory (never in a temporary worktree). Select verified provider assets, channel/account IDs and exact permissions for the episode. The `distribution-acquirer` stage saves official synopsis/character relationships in private `story-context.json` if available (prefer verified provider API; otherwise installed `webhelm platform run rs-boost metadata` Action); distinguish story facts from individual audio speaker identity. Preserve date-stamped rights evidence.
3. Acquirer records reusable material rights and authors `campaign.json` using the [campaign manifest schema](contracts/campaign-plan.schema.json), without selecting video variants. Preserve the full licensed original under `assets/`; verify `original_source_path` with `node scripts/check-original-source.mjs --run <absolute-canonical-run>`. On Worknode stage these **same verified original bytes** with hash/size/duration checks. Never analyze a generated preview.
4. Follow the DAG speech handoff: Video Use Scribe on the complete original (record `analysis/speech/scribe-source.json` with original and transcript digests before any shortcut reuse) → canonical `analysis/speech/scribe.json`, `analysis/speech/speaker-id.vtt` and `analysis/speech/boundaries.json` (via `node scripts/speaker-vtt.mjs from-scribe --input <scribe.json> --output <speaker-id.vtt> --boundaries <boundaries.json>`) → one Agent using the VTT and `evidence/story-context.json` → `analysis/speech/speaker-name.vtt`. Verify using `node scripts/speaker-vtt.mjs validate --source <speaker-id.vtt> --resolved <speaker-name.vtt> --story-context <story.json>`. The Agent may change only voice labels, never timestamps or dialogue; unknown names remain `speaker_N`. Keep raw word timings for cut safety; speech gaps are candidate boundaries, not guaranteed audio silence or final cuts. Copy Scribe output from Worknode to Neo Master through the existing Neo cluster file transport before running the canonical project script. Private `analysis/` results belong to the **canonical** Run, not to source worktrees or preview folders.
5. The Visioner reads the complete original **and named WebVTT** as separate evidence. Run installed Markcut Vision on the original with supported `--instruct` (concise story context) and `--skip-stt`; combine its observations with the full run-private VTT and Scribe timings in the Visioner handoff. Markcut Vision does **not** advertise `--transcript-file`; `--vtt` selects a video-to-text model, not a subtitle file. Editor selects as many distinct creative angles as the story supports, writes `creative-plan.json` using the [creative schema](contracts/creative-plan.schema.json), then owns original-time Markcut `video.md`, rendering and QA. Do not use Video Use's editing Agent or EDL, repeat STT, or split video into intermediate MP4s.
6. Obtain **one explicit owner Campaign publication authorization** scoped to series, accounts, edit types, visibility and link placement. Routine clips inside it do not require per-video owner or RS Boost approval. An actual owner-signed grant has not yet been enrolled for historical Runs.
7. After authorization, check public post receipts, impressions, clicks, qualified purchases, reported CPS commission and actual payout separately. A working redirect or dashboard registration is not a qualifying order.


No persistent service or `neo-project` lifecycle entrypoint is necessary for this agent-only project. The Graph specifies roles, not an automatically scheduled Job; use existing orchestration tools only when explicitly requested.

Release entrypoint (PRIVATE HOLD until a genuine owner Campaign grant and Run evidence exist): `node scripts/check-publication.mjs --run <canonical-private-run>`; `--reserve` records a unique attempt. See [commercial readiness](docs/commercial-readiness.md). A generic WebHelm post Action does not independently authorize publishing.
