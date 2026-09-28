---
name: neo-project
description: Create or refactor a Neo project so it follows Agents Relay-native architecture: thin project contract, chart-first README/AGENTS, one top-level durable Task per outcome, discoverable project agents, shared capabilities, run artifacts, and explicit quality/review gates.
---

# Neo Project

Use this skill when creating a new Neo project or refactoring an existing one to fit the Agents Relay operating model.

The goal is not to copy another project's files. The goal is to make each project **thin, understandable to humans, deterministic for Planner, and reusable across Agents Relay**.

## Capability tree

```text
Create / refactor a Neo project
│
├─ 1. define project boundary
│    ├─ what this project uniquely owns
│    ├─ what Agents Relay owns
│    └─ what shared Neo skills/agents own
│
├─ 2. create human + planner mental models
│    ├─ README.md  -> human architecture chart
│    └─ AGENTS.md  -> planner/task-topology chart
│
├─ 3. define durable work topology
│    ├─ one outcome -> one top-level durable Task
│    ├─ internal phases -> agentGraph
│    └─ exceptional durable lifecycle -> child Task
│
├─ 4. expose discoverable project roles
│    ├─ project-specific agents only when behavior is unique
│    └─ shared roles/capabilities are reused, never copied
│
├─ 5. define run artifacts
│    ├─ one run directory
│    ├─ canonical handoff artifacts
│    └─ evidence / QA / receipts stay with the run
│
└─ 6. define acceptance gates
     ├─ truth/evidence
     ├─ observable QA
     ├─ review gates when quality requires them
     └─ publication/external state verified, not inferred
```

## 1. Start with the project outcome

Before editing files, answer:

```text
What durable outcome does this project repeatedly produce?
```

Examples:

```text
Build Log -> one published daily build story
Vlog      -> one published vlog episode
Release   -> one verified software release
Research  -> one evidence-backed research result
```

Do not start from the existing folder tree. Existing files may represent obsolete architecture.

Then classify responsibilities:

```text
PROJECT
  owns domain-specific intent, contracts, quality bar, project agents

AGENTS RELAY
  owns Job / Task / task graph / agentGraph / retry / events / routing /
  leases / reconciliation / scheduling / recovery

SHARED NEO CAPABILITIES
  own reusable browser / vision / media / audio / publishing / release /
  model-routing / worker-routing / other cross-project implementation
```

If a capability is reusable outside this project, prefer a shared skill/agent instead of adding project-local implementation.

## 2. README.md is the human asset

`README.md` should let a human understand the project in one screen before reading details.

The first major section should be a **plain ASCII architecture chart**. Do not depend on Mermaid as the primary explanation.

Recommended shape:

```text
Long-lived Job / trigger
        │
        v
ONE durable outcome Task
        │
        v
Domain-specific work
        │
        v
Review / QA / external action
        │
        v
Verified outcome
```

README should explain:

- what the project produces;
- architecture/ownership at a glance;
- major artifact flow;
- what is intentionally not implemented locally;
- where to look for enforceable execution rules (`AGENTS.md`).

README is documentation, not the authoritative execution policy.

## 3. AGENTS.md is the Planner/execution asset

`AGENTS.md` is authoritative for agents working in the project.

Its first major section should be the **Planner topology chart**.

Default durable-work rule:

```text
One project outcome
       │
       v
EXACTLY ONE top-level durable Task
       │
       +--> agentGraph for normal internal phases
       │
       +--> child durable Task only for an exceptional lifecycle boundary
```

Do not create sibling top-level Tasks for ordinary phases of one outcome.

A child Task is justified only when work needs an independent durable lifecycle such as:

- external wait;
- explicit approval;
- independent retry/reconciliation boundary;
- durable blocker;
- independently resumed/owned result.

Otherwise keep the phase in the parent Task's `agentGraph`.

Planner must use agents visible in resolved project/shared context. Never invent agent names.

Do not hard-code provider/model/worker selection when Agents Relay routers own those decisions.

## 4. Project agents vs shared agents/skills

Create `project/agents/*.agent.md` only for behavior that is truly project-specific and important enough for Planner to discover by name.

Good project agents:

```text
build-log-editor
vlog-editor
vlog-producer
```

when they encode unique editorial or production behavior.

Do not create project-local copies of reusable roles such as:

```text
market
reviewer
release
vision-understanding
post-agent
Video Director
Execution Director
browser automation
model router
worker router
```

Use the shared implementation instead.

Rule:

```text
unique project judgment -> project agent
reusable cross-project capability -> shared agent/skill
```

If `AGENTS.md` references a project-specific agent, that agent must actually exist and be discoverable.

## 5. Project files stay thin

A healthy project normally looks like:

```text
<project>/
├── README.md
├── AGENTS.md
├── agents/                 # only project-specific roles, when needed
│   └── *.agent.md
└── runs/                   # ignored/private execution artifacts
```

Add other tracked files only when they are reusable project contracts, not one-run execution residue.

Avoid project-local copies of:

```text
scheduler
SQLite/job database
worker launcher
retry engine
routing config
model/provider policy
browser adapter
publication state machine
shared media engine
shared schemas already owned elsewhere
one-off scripts that duplicate a shared skill
```

When refactoring, identify and remove obsolete local implementation after verifying its responsibility is already owned by Agents Relay or a shared capability.

## 6. Define the run artifact contract

Each durable outcome should have one run root, normally:

```text
runs/<YYYY-MM-DD[-slug]>/
```

or another project-appropriate stable key when date is not the identity.

Keep all per-run state together:

```text
source/evidence
intermediate decisions
canonical handoff artifacts
assets
reviews
logs
generated output
QA
external receipts/status
```

Do not scatter one run across project-root `logs/`, `output/`, temporary folders, or redundant wrapper paths.

For content/video projects, prefer an explicit handoff chain such as:

```text
evidence/source
   -> story/creative intent
   -> visual-brief or equivalent direction asset
   -> video.md / executable media spec
   -> execution requirements
   -> assets
   -> review
   -> final render
   -> QA
   -> publish receipt
```

The exact artifacts are project-specific; their ownership and handoffs should not be implicit.

## 7. Chart-first contracts

Treat diagrams as primary assets, not decoration.

Required mental models:

```text
README.md
  #1 human architecture chart

AGENTS.md
  #1 Planner durable-task topology chart

Per-run direction artifact
  #1 execution/creative map for downstream workers
```

Prefer ASCII charts because they render reliably across ChatGPT clients and terminals.

Use prose to explain the chart, not replace it.

## 8. Quality and review gates

Acceptance must be observable.

Never equate these with success by themselves:

```text
command exited 0
file exists
render completed
button clicked
submission attempted
```

Define the evidence required to accept the outcome.

For content/media projects, a strong default is:

```text
creative/production draft
        │
        +--> specialist creative review
        +--> audience/market review when public-facing
        │
        v
required changes incorporated
        │
        v
final render/output
        │
        v
observable QA
```

Use review gates only when they materially protect output quality; do not mechanically copy Build Log's exact reviewers into unrelated projects.

For publication/external actions, persist platform-side receipt/state and distinguish submitted/reviewing/published/rejected/unknown when the platform supports those states.

## 9. Truth and evidence

Projects must define what counts as authoritative evidence for their domain.

Common rules:

- never fabricate missing state, media, metrics, results, or external success;
- distinguish observed facts from interpretation;
- preserve private source evidence in the run while sanitizing public outputs;
- if a required capability/input is unavailable, record a blocker rather than silently lowering the contract.

## 10. Creation workflow

For a new project:

```text
1. define repeated durable outcome
2. draw human architecture chart
3. draw Planner topology chart
4. assign ownership: project vs Agents Relay vs shared Neo
5. choose project-specific discoverable agents, if any
6. define run artifact/handoff contract
7. define acceptance/review/external verification gates
8. write README.md
9. write AGENTS.md
10. add only necessary project agents/contracts
11. verify no shared capability was duplicated locally
12. run one real outcome end-to-end
13. feed learnings back into project contract or shared capability
```

## 11. Refactor workflow

For an existing project:

```text
Current project
    │
    +--> inventory tracked implementation
    +--> inventory current Jobs/Tasks/agents/shared capabilities
    │
    v
classify every responsibility
    │
    ├─ project-specific contract? -> keep/simplify
    ├─ Agents Relay lifecycle?    -> remove local duplicate
    ├─ shared capability?         -> replace local copy with reference
    └─ run artifact/history?      -> keep under runs/, not implementation
    │
    v
rewrite README + AGENTS chart-first
    │
    v
make project agents discoverable
    │
    v
remove obsolete implementation
    │
    v
validate with one real Agents Relay outcome
```

Do not preserve a legacy abstraction merely because old runs used it.

## 12. Review checklist

Before calling a Neo project refactor complete, verify:

```text
[ ] README has a clear human architecture ASCII chart near the top
[ ] AGENTS has a clear Planner topology ASCII chart near the top
[ ] one durable outcome maps to one top-level Task by default
[ ] ordinary phases live in agentGraph, not sibling Tasks
[ ] exceptional durable work becomes child Tasks
[ ] all referenced project agents exist and are discoverable
[ ] reusable capability is shared instead of copied locally
[ ] project does not own Agents Relay lifecycle/runtime machinery
[ ] run artifacts have one stable root and explicit handoffs
[ ] success criteria require observable evidence
[ ] external publication/action has verification semantics
[ ] obsolete project-local scripts/config/schemas have been removed or justified
[ ] project-specific learnings are recorded without duplicating shared implementation docs
```
