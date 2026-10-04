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
- BGM is mandatory by default; source it through the shared audio-sourcing capability and mix/duck it around dialogue, narration, and meaningful original sound. SFX remain deliberate editorial choices.
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
- 2026-10-04: Route/movement evidence, mandatory BGM, spoken Hey Neo edit commands, lively motion/CG treatment, and Simplified Chinese defaults are enforceable production/review contracts rather than optional style suggestions.


## Route Story, language, movement, and command contract

When source photos or videos contain usable GPS/location metadata, location and movement are first-class story evidence rather than decorative metadata.

- Extract available GPS/location metadata and capture timestamps.
- Group media into supported stops and route segments without fabricating missing coordinates.
- Recognize movement mode from combined evidence, distinguishing at minimum walking/strolling, cycling, driving, and unknown.
- Do not infer movement from GPS speed alone when visual/audio evidence contradicts it. Use road/trail context, camera motion/height, vehicle/bicycle/interior evidence, time displacement, and clear source audio.
- Record confidence/evidence and prefer unknown over invention.
- Use route and movement mode to shape narration, pacing, transitions, and scene interpretation.
- Default generated titles, route narration, captions, chapter labels, and voiceover scripts to Simplified Chinese unless the user explicitly requests another language.
- Route Story narrative order is: where we went -> how we moved -> what happened there.
- Open with route/movement context when it helps the story; major location or movement changes may use short route transitions; end with a route recap when useful.
- If only some media has GPS, associate no-GPS media with a stop only when timestamp/context evidence supports it. With no usable GPS, use the normal non-route flow.

When source video contains speech, transcribe enough audio to detect explicit editing commands.

- Hey Neo is the default wake phrase; equivalent configured wake phrases may also be supported.
- Treat the utterance immediately after a wake phrase as an editing-instruction candidate, not ordinary story dialogue.
- Persist source clip/time range, recognized command, confidence/ambiguity, and resulting edit intent/action in run evidence.
- Apply clear supported instructions such as keep/remove/emphasize/reorder a shot, preserve original sound, add text/narration, change pacing, or choose a transition.
- Do not invent missing arguments for ambiguous commands.
- Normally exclude the wake phrase and command from final story audio unless the user clearly intends them to remain.

## Default visual-energy contract

- For ordinary personal/travel Vlogs, default to a joyful, light, lively, energetic tone unless the real source story clearly calls for another mood.
- Avoid a static slideshow feel. Use purposeful composition, cuts, motion, transitions, effects, tempo changes, and music-synchronized editing.
- Add meaningful motion graphics / CG / effects when they improve storytelling: dynamic route drawing, movement-mode graphics, kinetic typography, parallax/photo motion, speed ramps, freeze frames, playful graphic accents, or explanatory CG.
- CG/generated/effect material must remain clearly editorial/explanatory and must never masquerade as real source footage.

## Expanded review requirements

Video Director review must explicitly verify:

- hook, story-to-scene translation, and shot selection;
- lively pacing and avoidance of stiff/static slideshow treatment;
- purposeful cuts, transitions, motion graphics, CG/effects, and music-synchronized rhythm;
- mandatory BGM plus intelligible mix/ducking around dialogue, narration, and meaningful original sound;
- Route Story/map/movement-mode treatment when location evidence exists;
- compliance with recognized Hey Neo edit commands and correct treatment of command audio;
- source truth and clear separation of generated visuals from real footage.

Market Agent review must explicitly verify:

- audience clarity and hook/cover strength;
- emotional energy appropriate to the story, defaulting to joyful/light/lively for ordinary personal/travel Vlogs;
- curiosity/entertainment pull and platform fit;
- whether the episode feels engaging and dynamic rather than stiff, repetitive, or visually flat;
- whether route/movement context helps the viewer understand the journey when applicable.

Final QA must include observable BGM/mix, visual energy, effects, route/movement treatment when applicable, spoken-command compliance, and source truth.
