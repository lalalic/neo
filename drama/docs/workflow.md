# Drama production workflow

This document is the orchestration contract for repeatable Drama production. It exists so a new XChat session can resume the project without rediscovering who should do each job, what evidence is required, or when a stage is actually complete.

Machine-readable routing lives in `config/workflow.json`.

## Core principles

- One production run uses one top-level `job_id`. A repair is a state transition inside the same run, not a new top-level workflow.
- `runs/<run_id>/*.json` is durable business state. Event Bus is live telemetry. `runs/<run-id>/generated/manifest.json` is artifact-stage provenance.
- Agent role and model are separate. Choose the specialist agent first, then apply `model-router` for a new delegated model worker.
- Generation providers execute; they do not approve their own output.
- `generated != accepted`, `rendered != approved`, and `sent != delivered`.
- A stage advances only when its configured success evidence exists.
- Repair the smallest failed stage and preserve accepted upstream artifacts.

## 1. Responsibility map

```mermaid
flowchart TD
    U[User] --> O[XChat top-level orchestrator]
    O --> SP[Studio Producer\nproduction lead]
    O --> MR[Model Router]
    O --> EB[Event Bus]
    O --> RS[Run State\nruns/run_id]

    SP --> ND[Narrative Designer]
    SP --> IP[Image Prompt Engineer]
    SP --> SV[Short-Video Editing Coach]
    SP --> SO[Studio Operations]

    ND --> TTS[mlx-audio]
    IP --> AG[Agnes image/video]
    SV --> MC[Markcut]

    AG --> EC[Evidence Collector]
    TTS --> EC
    MC --> EC
    WB --> EC
    EC --> RC[Reality Checker]
    RC --> O
```

The orchestrator owns lifecycle and state. Specialist agents own domain decisions. Providers and skills execute bounded operations. Independent reviewers inspect observable artifacts.

## 2. Three-level routing

```mermaid
flowchart LR
    S[Workflow stage] --> A[Specialist agent]
    A --> M[Model Router]
    M --> W[Concrete worker model/profile]
    A --> X[Skill or provider execution]
    X --> R[Independent reviewer]
    R --> E[Evidence]
    E --> T[State transition]
```

Example: `shot` selects `image-prompt-engineer`; model-router chooses the worker model; Agnes executes; `evidence-collector` reviews frames and continuity evidence; only then does the episode state advance.

## 3. End-to-end episode pipeline

```mermaid
flowchart TD
    D[DRAFT] --> P[PREPARED]
    P --> G[GENERATING]
    G --> AR[ASSETS_READY]
    AR --> A[ASSEMBLING]
    A --> R[RENDERED]
    R --> TQ[TECH_QA]
    TQ --> VQ[VISUAL_QA]
    VQ --> RR[REVIEW_READY]
    RR --> AP[APPROVED]

    G --> RP[REPAIRING]
    A --> RP
    TQ --> RP
    VQ --> RP
    DL --> RP
    RP --> G
    RP --> A
    RP --> TQ
    RP --> VQ
    RP --> DL

    P --> B[BLOCKED]
    G --> B
    A --> B
    DL --> B
```

`FAILED` is reserved for a terminal failed run. `BLOCKED` means the run can continue when an external blocker is removed.

## 4. Stage-to-agent routing

```mermaid
flowchart TD
    ST[Story / episode design] --> ND[Narrative Designer]
    ND --> NAR[Narratologist review]

    C[Concept] --> IPE[Image Prompt Engineer]
    IPE --> BG[Brand Guardian review]
    IPE --> AI[Agnes image]

    D[Dialogue] --> ND2[Narrative Designer]
    ND2 --> TT[mlx-audio]
    TT --> SVA[Short-Video Editing Coach review]

    SH[Shot] --> IPE2[Image Prompt Engineer]
    IPE2 --> CONT[Short-Video Editing Coach\ncontinuity advice]
    CONT --> AV[Agnes video]
    AV --> EV[Evidence Collector]

    ED[Assembly / edit] --> SVE[Short-Video Editing Coach]
    SVE --> MK[Markcut]
    MK --> EV2[Evidence Collector]

    QA[Episode QA] --> RC[Reality Checker]
    EV3[Evidence Collector] --> RC

    W --> EV4[Evidence Collector verification]
```

The exact routing is defined in `config/workflow.json`. Before launching a configured agent, verify that `~/.codex/agents/<agent-id>.toml` exists. `./drama.sh workflow` reports that availability.

## 5. Shot continuity chain

```mermaid
flowchart LR
    CR[Canonical character ref] --> S1[Shot 01 input]
    LR[Location ref] --> S1
    VB[Episode visual bible] --> S1
    S1 --> V1[Shot 01 video]
    V1 --> E1[Shot 01 end frame]
    E1 --> S2[Shot 02 input]
    CR --> S2
    LR --> S2
    VB --> S2
    S2 --> V2[Shot 02 video]
    V2 --> E2[Shot 02 end frame]
    E2 --> S3[Shot 03 input]
```

A shot plan may set `continuity_from` to an earlier shot. `drama.py` then extracts the previous shot's final frame and uses it as the Agnes image-to-video input. This intentionally reduces freedom between adjacent shots.

Example:

```json
{
  "id": "shot02",
  "continuity_from": "shot01",
  "duration_sec": 5,
  "video_prompt": "桃桃保持上一镜头的外观和卧室光线，缓慢转向音乐盒……"
}
```

`continuity_from` must reference an earlier shot in the same episode.

## 6. QA and repair loop

```mermaid
flowchart TD
    X[Generated artifact] --> DQ[Deterministic checks\nffprobe / WAV validation / duration]
    DQ -->|fail| RF[Repair failed generation stage]
    DQ -->|pass| EC[Evidence Collector\nframes / refs / observable evidence]
    EC --> SQ[Specialist quality review]
    SQ --> RC[Reality Checker]
    RC -->|pass| NEXT[Advance state]
    RC -->|needs work| DIAG[Identify smallest failed stage]
    DIAG --> RF
    RF --> X
```

A model saying `PASS` is not enough. QA should combine deterministic media checks, sampled evidence, continuity checks, and narrative coverage.

## 7. State, events, and artifacts are different things

```mermaid
flowchart LR
    RUN[Run state\nwhat is true] --> ORCH[Orchestrator]
    EVT[Event Bus\nwhat is happening] --> ORCH
    MAN[runs/<run-id>/generated/manifest.json\nwhat artifacts were produced] --> ORCH
    SIDE[Artifact sidecars\nprovenance + hash + evidence] --> ORCH

    ORCH --> RUN
    ORCH --> EVT
```

Do not infer durable success from an event alone. Do not use `runs/<run-id>/generated/manifest.json` as the whole workflow state. Do not reconstruct live progress from state files when the Event Bus is available.

## 8. Event Bus lifecycle

```mermaid
sequenceDiagram
    participant O as Orchestrator
    participant E as Event Bus
    participant W as Worker
    participant U as User

    O->>E: subscribe job_id before worker starts
    O->>E: job.started
    O->>W: launch with same job_id and task_id
    W->>E: task.started
    E-->>O: visibility=user milestone
    O-->>U: render progress immediately
    W->>E: stage milestone / warning / repair
    E-->>O: event
    O-->>U: render meaningful milestone
    W->>E: task.completed
    O->>O: verify artifacts and durable state
    O->>E: job.completed only after reconciliation
    E-->>O: terminal event
    O-->>U: completion
```

A wait timeout is not completion. `task.completed` is not necessarily top-level completion. The owning orchestrator stays in the event loop until a top-level terminal event or an abnormal worker exit is reconciled.

## 9. External delivery adapter (outside Drama core)

```mermaid
sequenceDiagram
    participant O as Orchestrator
    participant S as Studio Operations
    participant W as wechat-bro
    participant V as Evidence Collector
    participant D as Destination

    O->>S: hand off APPROVED artifact identity
    S->>W: send-video for MP4/video
    W->>D: upload video
    W-->>S: transport result
    S->>V: verify destination-side evidence
    V->>D: inspect returned message / attachment evidence
    D-->>V: message or attachment identity
    V-->>O: verified external delivery receipt
```

This sequence is not part of the Drama core state machine. Drama remains `APPROVED` whether delivery succeeds or fails. A command invocation is not delivery proof. If transport returns an error, the external delivery job cannot emit success. A delivery receipt should bind destination to exact artifact hash/revision and destination message identity. For WeChat MP4/video, use `send-video`; use `send-file` only for non-video attachments.

## Artifact identity

Working renders may remain at `runs/<run-id>/generated/video/<episode>-render.mp4`, but anything handed to a reviewer or external destination should have an unambiguous identity:

```text
taotao-ep04-r001-a1b2c3d4.mp4
```

The delivery receipt should include episode, revision, SHA-256, duration, creation time, and source manifest version. This prevents ambiguity such as duplicate `001` or `002` files.

## Starting the next episode, for example ep04

A future request such as “generate 004” should be interpreted as a new episode production run, not as a direct call to Agnes.

1. Run `./drama.sh status` and `./drama.sh workflow`.
2. Create one `run_id` and one top-level Event Bus `job_id`; establish event consumption before delegation.
3. Route story work to `narrative-designer`, with `narratologist` review.
4. Add `ep04` to `runs/<run-id>/story/series.json`, then create `runs/<run-id>/episodes/ep04/script.json`, `shots.json`, and `storyboard.md`.
5. Use continuity fields in `shots.json` where adjacent shots should preserve composition or character state.
6. Run `./drama.sh prepare`.
7. Generate only missing assets. Reuse approved canonical assets.
8. Validate every generated video technically before marking its generation stage succeeded.
9. Assemble and render with Markcut.
10. Collect evidence and route final episode QA through `reality-checker`.
11. Stop the Drama core at `APPROVED`. If delivery is requested, launch a separate channel-adapter job from that approved artifact and verify destination-side evidence before completing the delivery job.
12. If anything fails, update the same run to `REPAIRING`, repair the smallest failed stage, and continue the same job.

## What to observe on the ep04 experiment

The next run is useful as a workflow experiment. Observe these separately:

- whether the correct specialist agent was selected at each stage;
- whether model routing happened after agent selection;
- whether one stable job/run survived repair cycles;
- whether progress was proactively surfaced from Event Bus;
- whether continuity inputs were actually used between shots;
- whether QA produced concrete evidence rather than self-confirming prose;
- whether upstream accepted artifacts were preserved during repair;
- whether final delivery used exact artifact identity and destination verification.

The goal of ep04 is not only a better video. It is evidence that the production system behaves coherently end to end.

## 10. Lessons from ep04 and the ep05 fast path

The ep04 run exposed orchestration overhead that was larger than the actual media-generation time. The durable fixes are part of workflow v3:

- **Event Bus ownership is singular.** XChat owns consumption. `studio-producer` and leaf specialists publish lifecycle/progress only; they never attempt `wait/history/progress/health`, so a worker cannot block the production because it lacks orchestrator-only read approval.
- **One writer per durable stage.** Story/prompt/edit files use a single-writer lease and serial gates. Parallel work is allowed only for independent provider execution with non-overlapping outputs and no continuity dependency.
- **Economy-first model routing.** Pick the specialist role first, then route each leaf job to the weakest suitable configured profile. Strong/high-reasoning models are an escalation path for ambiguous integration or failed evidence, not the default for every reviewer.
- **Bounded context.** A specialist receives only the files/evidence needed for its stage plus the exact output contract. It must not recursively rediscover the project or spawn nested agents.
- **No delivery state pollution.** Production remains `APPROVED`; an external delivery receipt can say `delivered`, but `DELIVERED` is not a Drama core state. `./drama.sh audit-run <run_id>` enforces this invariant.

For ep05, the expected control flow is therefore:

```mermaid
flowchart LR
    O[XChat orchestrator] -->|consume events| EB[Event Bus]
    O --> SP[Studio Producer]
    SP --> ND[Narrative Designer]
    ND --> NR[Narratologist gate]
    NR --> IP[Image Prompt Engineer]
    IP --> EC[Editing / continuity gate]
    EC --> GEN[Provider generation]
    GEN --> QA[Evidence + Reality QA]
    QA --> AP[APPROVED]
    AP -. optional separate job .-> DEL[External delivery receipt]

    SP -. publish only .-> EB
    ND -. publish only .-> EB
    NR -. publish only .-> EB
    IP -. publish only .-> EB
    EC -. publish only .-> EB
    QA -. publish only .-> EB
```

The goal is not to remove specialist agents. It is to make each specialist call bounded, non-overlapping, cheap by default, and justified by a quality gate.
