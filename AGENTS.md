# Neo Harness — source policy

Neo owns the native Rust Harness, CLI, shared Agents and reusable Skills.
Read [MISSION.md](MISSION.md) for identity; the mission is not authority to
spend, publish or make commitments. Follow the global agent rules.

## Ownership and discovery

- Rust is the only Harness implementation. Ship Neo independently and consume
  the installed Relay CLI through its compatible JSON interface; see [README.md](README.md).
  Neo.app installation belongs to the separate neox repository.
- The [Neo Project Skill](skills/neo-project/SKILL.md) owns Project discovery,
  Agent/Graph/Artifact contracts, canonical Runs, lifecycle and quality.
  Projects are independent Git roots directly beneath configured `NEO_ROOT`;
  Vlog and Content Distribution are not part of Harness Git.
- Agents Relay owns Jobs, Tasks, execution, reviews and recovery. Inspect
  their state through the installed Relay CLI, not internal storage or guessed
  execution identities. For portfolio coordination only, consult
  [control plane](docs/control-plane.md) and its private `.run/` records.

## Agent and prompt design

- The installed `agents-relay` Skill's `contracts/agent-contract.md` owns
  Agent inheritance, Context and Contract composition. Discover Skills by
  name rather than hard-coding installation paths.
- Keep project-wide engineering policy in project `AGENTS.md`, role behavior
  in Agent definitions and interfaces/invariants in their owning Contracts.
  Use explicit inherited `contexts` and named `required_skills`; directory
  Context is not automatic for all Workers. Implementation and Planner
  inherit project Context; ordinary DAG Stages do not unless declared.
  Put indispensable Stage behavior in its Agent or declared Contract, not
  solely in project `AGENTS.md`. Load detailed references only when needed.
- Reuse the shared Prompt Builder for native and web adapters. Verify actual
  assembled prompts and role behavior when changing instructions; do not
  compensate for runtime defects with duplicated rules.

## Engineering and delivery

- Preserve independent Git/Run boundaries and private inputs, media and
  evidence; follow the [Run Contract](skills/neo-project/references/run-contract.md).
- Reuse Markcut for media understanding/rendering and WebHelm for authorized
  browser/platform operations. Do not create parallel inference pipelines or
  use managed Relay ChatGPT Workers as synchronous vision inference.
- Verify user-visible outcomes, not merely command exit or transport PASS.
  For Agent quality, use the [Worker Evals Contract](skills/neo-project/references/worker-evals.md)
  and discovered `skill-builder`.
- Native installs and registry publications must report verified package
  version and source SHA via the shared Relay publication reporter; Events Bus
  is transport only. Staging is not installation. Keep general Events Bus
  and NATS private; remote release ingress needs separate authorization.
- External npm services managed by Neo.app use published `@latest` launchers.
  Project-owned services run canonical local source via `neo-project` and PM2,
  without private runtime copies or tarballs.
- Public hostnames: follow the
  [Neo.app shared-tunnel runbook](../neox/mac/NeoY/docs/shared-cloudflare-tunnel.md);
  reuse the app-owned connector.
- For authorized TestFlight delivery, use [apple-delivery](skills/apple-delivery/SKILL.md)
  and the [release playbook](docs/testflight-release-playbook.md). Verify the
  exact build, export compliance, tester distribution and installability on
  App Store Connect after upload.

## Authority and learning

Explicit owner authorization is required for external publishing, paid
services, private uploads and cloud mutations; Preview is not publication
consent. Preserve unrelated work and private evidence. Record reusable lessons
in the owning policy/Agent/Contract, replacing stale guidance rather than
appending incident histories. Consult
[historical lessons](docs/agent-execution-learnings.md) on demand.
