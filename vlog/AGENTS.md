# Vlog Project Rules

Vlog is a thin Neo content project. Root `AGENTS.md` and `MISSION.md` apply first.

## Planner topology — primary contract

This chart is the primary asset for Planner.

```text
                           VLOG JOB
                              │
                              v
               ┌──────────────────────────┐
               │ ONE TOP-LEVEL EPISODE    │
               │ TASK                     │
               │ vlog-YYYY-MM-DD[-slug]   │
               └────────────┬─────────────┘
                            │
                            v
                       agentGraph
                            │
                            v
                  ┌─────────────────┐
                  │ vlog-editor     │
                  │ source + story  │
                  │ visual brief    │
                  └────────┬────────┘
                           │
                           v
                  ┌─────────────────┐
                  │ vlog-producer   │
                  │ production draft│
                  └────────┬────────┘
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
                  ┌─────────────────┐
                  │ final render+QA │
                  └────────┬────────┘
                           │
                           v
                  ┌─────────────────┐
                  │ post-agent      │
                  │ when authorized │
                  └─────────────────┘
```

One episode = **exactly one top-level durable Task**.

Never create sibling top-level Tasks for source collection, media analysis, story, edit planning, production, review, render, QA, or publication of the same episode.

If a phase truly needs an independent durable lifecycle, create a child/descendant Task under the episode Task. Valid reasons include external wait, explicit approval, isolated retry/reconciliation boundary, durable blocker, or independently resumed work.

Use only discoverable agents. Do not invent agent names or hard-code worker/provider/model selection.

## Ownership

```text
Vlog-specific judgment
  -> vlog-editor / vlog-producer / this contract

Agents Relay lifecycle
  -> Job / Task / graph / retry / routing / events / reconcile

Reusable capability
  -> shared Neo agent/skill
```

Do not build Vlog-local copies of phone-media access, vision, Video Director, Execution Director, image/video generation, audio/TTS, Markcut, Market Agent, post adapters, model router, worker router, or troubleshooting.

## Source and story contract

Use only authoritative real media/evidence from the requested source window. Phone media should come through the installed shared phone-media/NeoX capability when needed.

PRs or system logs may support context when the episode is about technical work, but Vlog remains story-first rather than artifact-list-first.

The editor must produce one coherent arc:

```text
real media
   ↓
source-manifest.json
   ↓
HOOK -> MOMENT/TENSION -> DEVELOPMENT -> PAYOFF
   ↓
visual-brief.md
```

Do not widen dates, fabricate activities, or imply that media shows something it does not show.

## Visual-direction contract

`visual-brief.md` is the primary creative asset consumed by Producer and Video Director.

For each beat specify:

- audience intent;
- exact source media/evidence;
- selected shot/image/audio or missing capture requirement;
- crop/composition/visual treatment;
- motion/transition relationship;
- text/graphic/chart/diagram needs when they add meaning;
- original sound / narration / BGM / SFX intent.

Video Director turns the creative intent into canonical `video.md`. Execution Director compiles unresolved media requirements when needed. Runtime agents materialize assets; Markcut renders.

## Production quality

- Prefer real footage and useful original sound.
- Narration is optional. If used, it must use the user's approved voice identity unless an explicit fallback is authorized.
- BGM/SFX are deliberate editorial choices, not mandatory filler; mix them around dialogue/original sound.
- Use strong composition, meaningful cuts, motion, transitions, effects, and pacing.
- Use charts, diagrams, generated explanatory images, screenshots, or kinetic typography only when they improve comprehension without pretending to be real source evidence.
- Render vertical short-form video unless the Task specifies another format.
- Verify the observable final video, including picture, sound, pacing, and source truth.

## Mandatory pre-render gate

Final render is forbidden until both required reviews pass:

```text
Production Draft
      │
      ├────────────► Video Director Review
      │                  │
      │            PASS / CHANGE_REQUIRED
      │
      └────────────► Market Agent Review
                         │
                   PASS / CHANGE_REQUIRED

PASS + PASS -> Final Render
```

Video Director reviews hook, story-to-scene translation, shot selection, pacing, visual grammar, cuts/transitions/effects, and sound design.

Market Agent reviews audience clarity, hook/cover strength, emotional or curiosity pull, platform fit, and whether the episode works for someone without internal context.

Persist review evidence under `reviews/`. Required changes must be incorporated and re-reviewed.

## Run contract

```text
runs/<YYYY-MM-DD[-slug]>/
├── source-manifest.json
├── story.md
├── post.md
├── visual-brief.md
├── video.md
├── execution/
├── assets/
├── reviews/
│   ├── video-director.md
│   └── market.md
├── output/
├── qa.md
└── publish/
```

A genuine named series may use `runs/<series-name>/<YYYY-MM-DD[-slug]>/`. Do not create generic wrappers such as `runs/neo-vlog/` or `runs/daily-vlog/`.

All per-run artifacts belong in the run root. `runs/` is ignored by Git.

## Publication

Publication target/authorization comes from the active Job/Task. Use shared `post-agent`, verify platform-side state, and persist the receipt/status. A successful click or adapter exit code is not publication proof.

## Project learnings

- 2026-09-26: Vlog previously duplicated Agents Relay with local jobs, routing, autopilot, personas, style, and templates. Keep the project thin.
- 2026-09-27: Follow the shared `neo-project` contract: chart-first human/planner docs, one top-level Task per episode, discoverable project agents, shared capabilities, explicit run handoffs, and observable acceptance gates.
