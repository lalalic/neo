# Neo Build Log Project Rules

Neo Build Log is a thin content project. Root Neo instructions and `MISSION.md` apply first.

## Planner topology — primary contract

This chart is the primary asset for Planner. Preserve this topology unless the objective explicitly changes the episode model.

```text
                         BUILD LOG JOB
                              │
                              v
               ┌──────────────────────────┐
               │ ONE TOP-LEVEL EPISODE    │
               │ TASK                     │
               │ build-log-YYYY-MM-DD     │
               └────────────┬─────────────┘
                            │
                            v
                       agentGraph
                            │
                            v
                 ┌───────────────────┐
                 │ build-log-editor  │
                 │ evidence + story  │
                 │ hook + visual map │
                 └─────────┬─────────┘
                           │
                           v
                 ┌───────────────────┐
                 │ build-log-producer│
                 │ production draft  │
                 └─────────┬─────────┘
                           │
                  ┌────────┴─────────┐
                  │                  │
                  v                  v
         ┌────────────────┐  ┌────────────────┐
         │ Video Director │  │ Market Agent   │
         │ REQUIRED REVIEW│  │ REQUIRED REVIEW│
         └───────┬────────┘  └───────┬────────┘
                 │                   │
                 └─────────┬─────────┘
                           │
                     BOTH PASS
                           │
                           v
                 ┌───────────────────┐
                 │ final render + QA │
                 └─────────┬─────────┘
                           │
                           v
                 ┌───────────────────┐
                 │ post-agent        │
                 │ when authorized   │
                 └───────────────────┘
```

### Hard Planner rule

One episode = **exactly one top-level durable Task**.

Never create sibling top-level Tasks for evidence, story, poster, visual planning, production, review, render, QA, or publication of the same episode.

If something genuinely needs its own durable lifecycle:

```text
Need independent durable lifecycle?
            │
      ┌─────┴─────┐
      │           │
     NO          YES
      │           │
      v           v
 agentGraph    CHILD TASK
                  │
                  v
          under Episode Task

          NEVER a new top-level sibling
```

Valid reasons for a child Task include an external wait, explicit approval, isolated retry boundary, durable blocker, or independently resumed work. Ordinary production phases remain in the episode Task's agentGraph.

Planner must use discoverable agents only and must not hard-code worker/provider/model selection.

## Execution invariants

The episode Task owns the whole outcome:

```text
Evidence
  -> Story
  -> Hook / Poster
  -> Visual Brief
  -> Production Draft
  -> Video Director Review
  -> Market Review
  -> Final Render
  -> QA
  -> Publish
```

Do not add a project-local scheduler, workflow database, task engine, routing policy, worker launcher, retry system, publication browser adapter, or lifecycle state machine. Agents Relay owns orchestration; shared Neo skills own reusable execution capabilities.

## Story contract

Build Log is **story-first, never PR-first**.

```text
PRs / commits / Tasks / events / logs
                 │
                 v
              EVIDENCE
                 │
                 v
HOOK -> TENSION -> ATTEMPT -> TURNING POINT -> CHANGE -> RESULT -> PAYOFF
```

The first beat must contain a concrete hook. Do not open with branding, a date, a PR number, a list of work completed, or generic progress language. The poster/cover must carry the same hook visually.

Omit unrelated work even if it happened that day.

## Visual-direction contract

`visual-brief.md` is the primary episode asset consumed by Producer and Video Director.

For every important beat it must specify:

- audience intent: what the viewer should understand or feel;
- evidence source;
- visual form: screen recording, screenshot, chart, diagram, explanatory image, generated visual, kinetic typography, or text when truly appropriate;
- motion/transition relationship to adjacent beats;
- narration intent;
- BGM/SFX intent when relevant;
- missing asset or capture requirement.

`video.md` is derived from the visual brief; it is not a replacement for visual thinking.

## Required video/audio quality

A normal successful video must include:

- the user's approved narration voice identity; generic fallback TTS is forbidden unless explicitly approved;
- BGM mixed beneath narration with appropriate ducking;
- a strong first-screen hook and hook-driven poster/cover;
- deliberate use of charts, diagrams, explanatory images, screenshots/screen recordings, kinetic typography, and other rich components where useful;
- intentional motion, pacing, transitions, effects, and visual hierarchy.

Do not produce a video that is mainly static text cards with narration. If the approved voice or required media cannot be obtained, preserve the blocker rather than silently lowering the standard.

## Mandatory pre-render gate

Final render is forbidden until both reviews explicitly pass.

```text
Production Draft
      │
      ├──────────────► Video Director Review
      │                    │
      │              PASS / CHANGE_REQUIRED
      │
      └──────────────► Market Agent Review
                           │
                     PASS / CHANGE_REQUIRED

Only PASS + PASS
      │
      v
Final Render
```

Video Director review covers hook/opening, story-to-scene translation, pacing, visual variety/composition, charts/images/components, motion/transitions/effects, and narration/BGM plan.

Market Agent review covers audience clarity, hook strength, poster/cover, positioning/curiosity pull, avoidance of PR-/Task-centric framing, and platform fit.

Persist review evidence in:

```text
reviews/video-director.md
reviews/market.md
```

Required changes must be incorporated and re-reviewed before final render.

## Truth and evidence

For the target local date:

- use authoritative conversation, Agents Relay, GitHub, runtime, and artifact evidence;
- distinguish observed facts, interpretation, and unknowns;
- never fabricate progress, success, failures, screenshots, footage, metrics, or motivations;
- remove credentials, private identifiers, internal-only URLs, sensitive personal material, and unsuitable private context from public outputs;
- preserve useful authoritative references in private evidence and next-day artifacts.

## Required run outcome

A normal successful run should produce:

```text
runs/<YYYY-MM-DD[-slug]>/
├── evidence.md
├── story.md
├── post.md
├── visual-brief.md
├── video.md
├── poster/
├── assets/
├── reviews/
│   ├── video-director.md
│   └── market.md
├── output/
├── qa.md
├── publish/
└── next-day-brief.md
```

Do not add a redundant `runs/neo-build-log/` wrapper. All per-run evidence, drafts, generated assets, Markcut state, review evidence, logs, QA, private continuation notes, and publication receipts belong in the dated run.

A command exiting successfully, a valid Markcut file, or the existence of an MP4 is not sufficient acceptance.

## Publication

Publication target and authorization belong to the autonomous Job or specific Task, not this project. When authorized, use shared `post-agent`, perform duplicate-safe platform verification, and persist the exact receipt/state.

## Project learnings

- 2026-09-12: A Build Log should expose a concrete gap/payoff immediately and derive its story from observable work, not a generic tutorial.
- 2026-09-26: Treat Build Log as a thin content project; Agents Relay owns execution orchestration.
- 2026-09-26: Build-Log-specific roles must be real discoverable project agents; reusable execution remains in shared skills.
- 2026-09-27: One episode has exactly one top-level durable Task; exceptional durable work may exist only beneath it.
- 2026-09-27: Final render requires Video Director + Market Agent review. Hook, poster, approved voice, BGM, rich visuals, motion/transitions/effects, and story-first framing are required.
