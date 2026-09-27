# Neo Build Log Project Rules

Neo Build Log is a thin content project. Root Neo instructions and `MISSION.md` apply first.

## Ownership

Do not add a project-local scheduler, workflow database, task engine, routing policy, worker launcher, retry system, publication browser adapter, or lifecycle state machine.

Agents Relay owns orchestration. Shared Neo skills own reusable execution capabilities. This project owns only Build-Log-specific content behavior and its ignored run artifacts.

## Planner contract

When a planner receives a Build Log objective:

- resolve this project and use its visible project agents;
- create **exactly one top-level durable Task for one target day/episode**;
- never create multiple sibling top-level Tasks for evidence, story, video, review, QA, or publishing of the same episode;
- keep evidence reconstruction, story editing, visual planning, narration, BGM, poster, review, production, render, QA, and publication inside that Task's `agentGraph`;
- if a phase truly needs an independent durable lifecycle, create a **child/descendant Task under the episode Task**, never another top-level sibling;
- never invent unavailable agents;
- do not hard-code worker/provider/model selection;
- do not split ordinary workflow mechanics into sibling Tasks.

The preferred internal shape is:

```text
Build Log Job
  |
  +-- Episode Task  <-- the ONE top-level Task
       |
       +-- agentGraph
       |    build-log-editor
       |       |
       |       v
       |    build-log-producer: production draft
       |       |
       |       +--> Video Director review  [required]
       |       +--> market review          [required]
       |       |
       |       v
       |    build-log-producer: final render + QA
       |       |
       |       v
       |    post-agent when authorized
       |
       +-- exceptional child durable Tasks only
```

## Truth and evidence

For the target local date:

- use authoritative conversation, Agents Relay, GitHub, runtime, and artifact evidence;
- distinguish observed facts, interpretation, and unknowns;
- infer intent only when supported by real discussion/work evidence;
- never fabricate progress, success, failures, screenshots, footage, metrics, or motivations;
- remove credentials, private identifiers, internal-only URLs, sensitive personal material, and other unsuitable private context from public outputs;
- preserve useful authoritative references in private evidence/next-day artifacts.

## Story and hook contract

Build Log must be **story-first, never PR-first**. PRs, commits, Tasks, events, and logs are evidence sources, not the episode outline. Find one human-readable narrative: problem -> tension -> investigation/attempt -> turning point -> change -> evidence/payoff.

The first beat must contain a concrete hook. Do not open with branding, a date, a PR number, a list of completed work, or a generic summary. The poster/cover must carry the same hook in a visually immediate form.

## Required video/audio quality

A normal successful video must include:

- the user's approved narration voice identity; generic fallback TTS is not acceptable unless explicitly approved;
- BGM mixed beneath narration with appropriate ducking;
- a strong first-screen/first-beat hook and hook-driven poster/cover;
- deliberate use of charts, diagrams, explanatory images, screenshots/screen recordings, kinetic typography, and other rich components where useful;
- intentional motion, pacing, transitions, effects, and visual hierarchy.

Do not produce a video that is mainly static text cards with narration. If the approved voice or required media cannot be obtained, preserve the blocker rather than silently downgrading quality.

## Mandatory pre-render review gate

Final render is forbidden until both reviews are complete and passing:

1. **Video Director review** of draft `video.md`, poster/cover, audio plan, and preview/production plan for hook, story-to-scene translation, pacing, visual variety/composition, charts/images/components, transitions/effects/motion, and narration/BGM.
2. **Market Agent review** of the same draft plus poster/social package for audience-facing hook, clarity without internal context, poster hook, positioning/curiosity pull, avoidance of PR-/Task-centric framing, and platform fit.

Persist explicit `PASS` or `CHANGE_REQUIRED` evidence for both. Required changes must be incorporated and re-reviewed before final render.

## Required content outcome

Build Log is a content package, not a text-only report.

A normal successful run should produce:

- evidence/source notes;
- a public narrative story;
- concise social copy;
- a Markcut-compatible `video.md`;
- a hook-driven poster/cover artifact or production-ready spec;
- real captured/generated media when required and available;
- narration using the approved user voice;
- BGM;
- Video Director and Market Agent pre-render review evidence;
- a rendered video when technically possible;
- observable QA notes;
- publication receipt/status when the Task authorizes publication;
- a private next-day work-start brief.

If real media is unavailable, do not substitute fake evidence. Preserve a truthful storyboard/capture plan and exact blocker so a retry can continue without repeating completed editorial work.

## Run contract

Use the root universal run layout:

```text
runs/<YYYY-MM-DD[-slug]>/
```

Do not add a redundant `runs/neo-build-log/` wrapper. Every per-run artifact belongs in the dated run: evidence, drafts, media, generated assets, Markcut state, logs, QA, next-day brief, and publication receipts.

## Publication

Publication target and authorization belong to the autonomous Job or specific Task, not this project. When authorized, use shared `post-agent`, perform duplicate-safe platform verification, and persist the exact receipt/state. Authentication or platform blockers must be reported truthfully.

## Project learnings

- 2026-09-12: A Build Log should expose a concrete gap/payoff immediately and derive its story from observable work, not a generic tutorial.
- 2026-09-26: Treat the Build Log as a content project. The tracked project defines editorial behavior and project agents; Agents Relay owns execution orchestration.
- 2026-09-27: One episode has exactly one top-level durable Task; exceptional durable work may exist only beneath it.
- 2026-09-27: Final render requires Video Director + Market Agent review. Hook, poster, approved voice, BGM, rich visuals, motion/transitions/effects, and story-first framing are required.
- 2026-09-26: A prose reference to a shared role is insufficient if that role is not discoverable in resolved planner context. Build-Log-specific editorial/production roles must be real project agents; reusable execution remains in shared skills.
