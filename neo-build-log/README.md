# Neo Build Log

Neo Build Log turns real Neo work into one evidence-backed daily story package: story, social copy, poster, polished short-form video, publication evidence, and a private next-day brief.

This project is intentionally thin: it defines the content contract; Agents Relay owns orchestration and runtime lifecycle.

## Human mental model

This chart is the primary architecture asset for understanding the project.

```text
                    NEO BUILD LOG 2.0

              ┌──────────────────────┐
              │ Autonomous Daily Job │
              └──────────┬───────────┘
                         │
                         v
              ┌──────────────────────┐
              │ ONE Episode Task     │
              │ YYYY-MM-DD           │
              └──────────┬───────────┘
                         │
                         v
              ┌──────────────────────┐
              │ Evidence + Story     │
              │ Hook / Tension       │
              │ Turning Point        │
              │ Payoff               │
              └──────────┬───────────┘
                         │
                         v
              ┌──────────────────────┐
              │ Production Draft     │
              │ video.md             │
              │ poster / voice / BGM │
              │ visuals / motion     │
              └──────────┬───────────┘
                         │
                 ┌───────┴────────┐
                 │                │
                 v                v
        ┌────────────────┐  ┌────────────────┐
        │ Video Director │  │ Market Agent   │
        │ Review         │  │ Review         │
        └───────┬────────┘  └───────┬────────┘
                │                   │
                └─────────┬─────────┘
                          │
                    BOTH PASS
                          │
                          v
              ┌──────────────────────┐
              │ Final Render + QA    │
              └──────────┬───────────┘
                         │
                         v
              ┌──────────────────────┐
              │ Publish + Receipt    │
              └──────────────────────┘
```

The central idea is simple:

- one episode is one story;
- one story is one top-level durable Task;
- production work stays inside that episode Task;
- final render happens only after Video Director and Market Agent both pass the draft.

## Ownership map

```text
┌─────────────────────────────┐
│ neo-build-log               │
│                             │
│ story contract              │
│ hook / poster               │
│ quality bar                 │
│ project agents              │
└──────────────┬──────────────┘
               │
               v
┌─────────────────────────────┐
│ Agents Relay                │
│                             │
│ schedule / Job / Task       │
│ agentGraph / retry          │
│ routing / events            │
│ reconciliation / recovery   │
└──────────────┬──────────────┘
               │
               v
┌─────────────────────────────┐
│ Shared Neo capabilities     │
│                             │
│ Video Director / Market     │
│ browser / vision / media    │
│ TTS / BGM / Markcut / post  │
└─────────────────────────────┘
```

Neo Build Log does not own a local scheduler, workflow engine, retry engine, browser adapter, media engine, model router, or publication state machine.

## Episode artifact flow

The most important per-episode asset for production is `visual-brief.md`: it translates story intent into visual execution. `video.md` is the executable Markcut specification derived from it.

```text
Real work
   │
   v
 evidence.md
   │
   v
 story.md
   │
   v
 visual-brief.md      <-- primary visual direction asset
   │
   ├── hook / poster
   ├── chart / diagram / image / screen evidence
   ├── motion / transition intent
   ├── narration / approved voice
   └── BGM / audio intent
   │
   v
 video.md             <-- executable video specification
   │
   v
 reviews/
   ├── video-director.md
   └── market.md
   │
   v
 final MP4 + QA
   │
   v
 publish receipt
```

A normal run lives under:

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

All `runs/` content is ignored by Git.

Validate a completed dated run before accepting it:

```sh
python3 scripts/validate_episode_completion.py runs/2026-10-02 --require-publication
```

## Story standard

A Build Log is a human story about building, failing, discovering, deciding, and making something work. PRs, commits, Tasks, and events are evidence sources, not the episode outline.

The narrative normally follows:

```text
HOOK
  ↓
Problem / Tension
  ↓
Attempt / Failure / Investigation
  ↓
Discovery / Turning Point
  ↓
Actual Change
  ↓
Observable Result
  ↓
Payoff / Next Question
```

The first beat and poster must communicate the hook immediately. Do not open with branding, a date, a PR number, or a changelog.

## Video quality bar

A normal final video requires the user's approved narration voice, BGM ducked under narration, rich visual treatment, deliberate motion/transitions/effects, and observable QA. Use charts, diagrams, explanatory images, screenshots, recordings, kinetic typography, and other strong visual components when they communicate the story better than prose.

A technically valid Markcut file is not sufficient acceptance.

## Project agents

- `build-log-editor` owns story reconstruction, hook, poster hook, and `visual-brief.md`.
- `build-log-producer` owns the production draft, review gates, final render, and QA.
- shared `market` reviews audience clarity, hook, poster, positioning, and platform fit.
- shared Video Director reviews scene structure, pacing, visuals, motion, transitions/effects, and audio intent.
- shared `post-agent` handles authorized publication.

See `AGENTS.md` for the planner/execution contract.
