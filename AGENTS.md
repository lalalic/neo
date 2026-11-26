# Neo Harness source rules

Neo is the installable agent Harness and CLI source, with reusable Agents and Skills. Ordinary Neo.app users do not clone this repository; The Harness now has one native Rust implementation and versioned native bundles. The separate Neo.app installer must migrate from its historical npm distribution. Do not restore a Node Harness entrypoint. Vlog and Content Distribution are independently Git-rooted Neo Projects on Neo Master; their source is excluded from the Harness Git index. The CLI discovers only direct independent Git repositories beneath `NEO_ROOT` (default `~/Workspace`, with an explicit Neo Master configuration of `~/Workspace/neo`). Historical source-only project directories are not discoverable Neo Projects. Read [MISSION.md](MISSION.md) for identity and mission context; the mission is not authorization to spend, publish, merge or make commitments. Follow the global execution harness and discover installed Skills contextually, rather than hard-coding their paths.

## Project resolution

The [Neo Project Skill](skills/neo-project/SKILL.md) is the single authority for independent Project discovery, Git/Run boundaries, Agent/Graph/Artifact contracts, approval, project lifecycle and worker quality. Load its specific `references/` file only when the task requires it. Read this Harness policy, the selected Project's `AGENTS.md` and README, and only relevant role files; project-only rules belong to the selected Project. Do not duplicate Project contracts in this Harness AGENTS.md.

For Neo Master public hostname additions, updates, or retirement, the source of
truth and procedure are the [Neo.app shared-tunnel runbook](../neox/mac/NeoY/docs/shared-cloudflare-tunnel.md).
Use the existing app-owned connector, not a Project-owned or PM2 tunnel.

## Verified publication

Native installations and registry publications must automatically report their
actual verified package version and source SHA through the shared Agents Relay publication reporter (the publication contract belongs
to Agents Relay; [Events Bus](skills/events-bus/SKILL.md) is transport only).
Use the shared local .mjs reporter or approved GitHub composite Action, not
an ad-hoc Python release reporter or fabricated Job identity. Staging/building
an artifact alone is not proof of native installation. Remote GitHub runners
require a separately authorized release-only ingress; keep the general Events
Bus API and NATS private.

## Canonical execution and Git boundary

Follow the [Neo Project Run Contract](skills/neo-project/references/run-contract.md) for canonical private Runs, nested local Git and source-worktree separation. Keep private media, source inputs, credentials, artifacts and receipts out of published Harness Git. Preserve original private Runs and unrelated worktrees.

## Work, roles and evidence

The control plane is the private `.run/PLAN.md`, `.run/state.json` and project task handoffs when present; read them only for portfolio coordination (see [control plane](docs/control-plane.md)). The applicable Job/Task state must come from the discovered Agents Relay CLI, never internal databases, HTTP APIs or guessed records. Keep task owners, destinations, status and evidence aligned at handoffs; do not invent execution IDs, approval or completion.

Use the smallest relevant role/skill context, local command `--help`, project schemas and real artifacts. Agent roles describe responsibility; adapters provide bootstrap and execution transport. The canonical event-bus protocol governs delegated lifecycle events. Subscribe/monitor where relevant, relay concrete progress, terminal failures and resource releases. Worker implementation includes self-review → fix → re-review until review has no actionable changes; verify results as a user rather than treating successful subprocess exit as evidence.

Reuse shared Markcut media understanding and rendering capability; do not create parallel inference pipelines or use a managed Relay ChatGPT Worker as synchronous vision inference. Optional browser/platform operations use the discovered WebHelm Skill and its active session lifecycle; do not hard-code outdated CDP ports or browser implementation details.

All external posting and publishing requires explicit owner permission. Draft/preview consent is not publication consent. Paid services, private uploads, credentials, private data or cloud mutations require their owning authorization gates. Services shipped as external npm packages and managed by Neo.app must use published `@latest` launchers rather than fixed npm version strings; the package publication watcher handles those updates. **Project-owned local services** with canonical `lib/` and `scripts/` should instead run source scripts directly from their project via `neo-project` and PM2, without a duplicate `.tgz` or private runtime copy. Local archive or tarball sources are not registry packages.

## Project Worker quality

For Neo Project Worker quality, use the [Worker Evals Contract](skills/neo-project/references/worker-evals.md) and discovered global `skill-builder`; do not substitute Relay transport PASS for a domain-outcome evaluation.

## Software distribution

For any authorized iOS/TestFlight release, load the shared [apple-delivery Skill](skills/apple-delivery/SKILL.md) and consult the [TestFlight release playbook](docs/testflight-release-playbook.md): check existing API-key upload capabilities before treating an Xcode login prompt as an owner-only blocker, and **always inspect the actual App Store Connect TestFlight website after upload** for encryption compliance, the exact build, tester-group distribution, and installability.

## Learning

Capture durable project-specific lessons in the project's `AGENTS.md` and role-specific details in its Agent files. Cross-project rules alone belong here. Distill the observation and future action; keep incident logs, detailed evidence and one-off workarounds in private run records. Consult [historical agent/platform lessons](docs/agent-execution-learnings.md) only when relevant, not as automatic Worker context. Review obsolete lessons and remove contradictions.
