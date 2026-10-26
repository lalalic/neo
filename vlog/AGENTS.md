# Vlog Project Rules

Vlog is a thin Neo content project. Root `AGENTS.md` and `MISSION.md` apply first.

All Vlog episodes obey [the stage acceptance contract](docs/episode-stage-contract.md). Do not create an episode Task for a manifest with `INPUT_NEEDED`; source-use approval is mandatory. Archive accepted output by default, publishing only after explicit human authorization. Review corrections are Relay lifecycle work rather than agentGraph cycles.

## Canonical Episode Graph — primary project asset

The Episode Graph describes only durable Agent outcomes, not review,
validation or self-repair work:

```text
iCloud Watcher (outside episode graph)
  -> Visioner (validated source understanding)
  -> Vlog Editor (validated story and visual brief)
  -> Vlog Producer (validated video and specialist self-review)
  -> Final render and technical QA (private archive)
```

Each Agent owns its `execute -> validate/review -> repair -> valid outcome`
loop inside the same Worker. The Producer calls `agents-relay review run`
with a review Prompt and professional `video-director,market` agents; the
generic Outcome Reviewer is implicit. All must PASS on the current preview
before Producer can report success. Markcut technical checks remain part of
the producing Agent's work. Neither Review nor Fix is a separate Episode Task.

The first Visioner Task is the one root Episode Task. Editor, Producer and
Final QA are dependent descendants. Planner enforces this tree with
`scripts/validate-episode-plan.mjs`. Watcher owns media ingestion and
integrity; Visioner reuses existing Markcut `input/media/metadata.json`
perception before requesting only missing observations.

Optional source Human Review stays within Visioner; no HIL Action is added in
this prototype. Source-use approval and public publishing authorization remain
separate from technical/content PASS. Do not publish without owner permission.

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

## Editor-owned story enrichment

Editor chooses whether GPS route, timely local events, and popular nearby locations help the *recorded* episode. Research is optional and does not add Graph nodes. Record the decision and source provenance in the run; externally researched attractions/events may be labeled context but are not proof of a visit. Reject unverified dates, invented stops, and unapproved sensitive locations. Choose a source-grounded first-three-second hook, deliver its promised payoff, and retain real creator speech, imperfections and personality without inventing inner thoughts. Market review validates audience retention, authenticity, contextual accuracy, privacy and justified omission.

## Optional location branch

The episode and its hook/development/payoff exist independently of GPS. Do not create or require a map scene without useful trustworthy metadata, creative relevance and explicit disclosure approval. No GPS means a complete ordinary episode; partial GPS means only verified sample locations, never invented stops or movement. Reject implausible points, ambiguous timestamps and sensitive coordinates. Label calculated road routes as inferred navigation, not recorded tracks. Preserve the canonical Agent outcome tree, Chinese narration/captions by default, authorized BGM, Producer-owned reviews and publication approval.

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

Producer validates the Markcut preview, then invokes the Relay review Action
using a `--prompt-file` that cites the current revision and source evidence.
The implicit generic Reviewer checks outcome validity; Video Director checks
visual storytelling, sound and pacing; Market checks audience clarity and
authentic engagement. Producer incorporates all required changes and reruns
verification before completing. Persist results in `reviews/`.
Final QA observes the actual render, not only CLI success.

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
- 2026-10-26: Watcher owns media integrity; Planner and Visioner work from the manifest and existing Markcut Vision metadata. Reuse cached perception before invoking missing media analysis.
- 2026-10-26: Before applying an episode Plan, reconcile the supplied Job ID against Relay's durable local Job list; inherited planner context can reference a Job that is not present, and another episode Job must never be substituted.
- 2026-10-26: Persistent watcher lifecycle is exposed by `./neo-project`; PM2 runs the packaged watcher, and `health` checks real iCloud Inbox access.

- 2026-09-26: Vlog previously duplicated Agents Relay with local jobs, routing, autopilot, personas, style, and templates. Keep the project thin.
- 2026-09-27: Follow the shared `neo-project` contract: chart-first human/planner docs, one top-level Task per episode, discoverable project agents, shared capabilities, explicit run handoffs, and observable acceptance gates.
- 2026-10-04: Route/movement evidence, mandatory BGM, spoken Hey Neo edit commands, lively motion/CG treatment, and Simplified Chinese defaults are enforceable production/review contracts rather than optional style suggestions.
- 2026-10-21: Route/location research is optional work owned by `vlog-editor` with shared capabilities, not missing specialist graph nodes. Synthetic review fixtures must materialize every dependency and immutable r1/r2 revision, including per-beat sound/motion/transition evidence; hash real bytes, reject changed/stale dependencies, and never treat simulation, parser validation, or authorization booleans as QA or publication eligibility.


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
- Optional map/movement-mode treatment only when reliable location evidence and disclosure approval exist; no-GPS episodes need no maps;
- compliance with recognized Hey Neo edit commands and correct treatment of command audio;
- source truth and clear separation of generated visuals from real footage.

Market Agent review must explicitly verify:

- audience clarity and hook/cover strength;
- emotional energy appropriate to the story, defaulting to joyful/light/lively for ordinary personal/travel Vlogs;
- curiosity/entertainment pull and platform fit;
- whether the episode feels engaging and dynamic rather than stiff, repetitive, or visually flat;
- whether route/movement context helps the viewer understand the journey when applicable.

Final QA must include observable BGM/mix, visual energy, effects, route/movement treatment when applicable, spoken-command compliance, and source truth.
