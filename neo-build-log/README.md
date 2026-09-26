# Neo Build Log

Neo Build Log is a Neo content project that turns real work into an evidence-backed daily story package: public narrative, social copy, video, and a private next-day brief.

The project is intentionally thin. It defines what a good Build Log is; Agents Relay decides when and how work runs.

## Project boundary

- **This project owns:** editorial truth, story shape, public/private output requirements, and Build-Log-specific agent roles.
- **Agents Relay owns:** autonomous scheduling, planner rounds, durable Jobs/Tasks, Task Agent Graph execution, retries, dependencies, routing, leases, reconciliation, and recovery.
- **Shared Neo skills own:** browser/capture access, media understanding, image/video generation, audio/TTS, Markcut rendering, and publication adapters.
- **Runs own:** all real evidence, drafts, media, generated assets, QA, receipts, logs, and private operational notes.

No Job ID, schedule, publication platform, model/provider choice, or current episode date is part of this tracked project definition.

## Execution model

One daily Build Log normally maps to one durable Agents Relay Task.

```text
Autonomous Job
  -> planner resolves this project
  -> one daily Build Log Task
       -> agentGraph
            build-log-editor
            -> build-log-producer
            -> reviewer when useful
            -> post-agent when authorized
  -> run artifacts
```

Internal production phases stay inside the Task Agent Graph. Create durable child Tasks only when a result genuinely needs an independent retry, blocker, approval, or external dependency boundary.

## Content package

A successful run is not just a Markdown summary. It should leave a coherent package under one dated run:

```text
runs/<YYYY-MM-DD[-slug]>/
├── evidence.md
├── story.md
├── post.md
├── video.md
├── assets/
├── output/
├── qa.md
├── publish/
└── next-day-brief.md
```

Files may be omitted when they are genuinely not applicable, but a normal Build Log should include both public story copy and a visual/video artifact path. If required source media cannot be obtained, preserve the exact blocker and a truthful storyboard/capture plan rather than fabricating visuals.

All `runs/` content is ignored by Git.

## Editorial standard

The Build Log is a story about real work, not a dump of PRs or Tasks. It should usually have:

1. a concrete hook;
2. the real problem or constraint;
3. an attempt, failure, discovery, or decision;
4. the actual build/change;
5. observable evidence of the result or unresolved state;
6. a useful payoff and natural next hook.

Select the strongest coherent story from the day. Separate facts from interpretation. Never invent motivation, progress, screenshots, footage, results, or metrics.

## Project agents

- `build-log-editor` reconstructs the evidence-backed story and defines what the audience should see and understand.
- `build-log-producer` turns the approved story into a real visual/video content package using shared media, Markcut, audio, QA, and capture capabilities.
- Shared `post-agent` handles publication only when the Job/Task authorizes a platform.

See `AGENTS.md` for the enforceable contract.
