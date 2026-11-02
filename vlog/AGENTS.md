# Vlog — project execution policy

Vlog produces one evidence-grounded short-form episode from real, owner-authorized media. Root `AGENTS.md` and `MISSION.md` apply. The canonical stage input/output, revision and failure contract is [episode-stage-contract.md](docs/episode-stage-contract.md); load only the sections relevant to the assigned Stage.

## Planner topology

The [Graph](graph.mmd) is the only normal-stage ordering:

```text
Visioner -> vlog-director -> vlog-editor -> vlog-producer -> vlog-final-qa
```

Watcher/ingress runs outside the Graph. For the current Relay episode model, one Job owns the outcome; its initial Plan creates all five normal Stage Tasks with predecessor dependencies. Do not invent an empty parent Task, extra Graph nodes, review Tasks, or feedback edges. Task parentage expresses ownership, not the Graph. Later revision/recovery work is Relay-owned. Agents and adapter/model routes must resolve from the active execution context.

## Ownership and gates

- **Shared Visioner** records observations, hashes, source timecodes and uncertainties using Markcut; it does not select the story or edit clips.
- **Director** chooses a truthful goal, scene progression and payoff; writes `story.md`, `shot-selection.json`, `visual-brief.md` and `post.md`. **Editor** resolves source-linked in/out cuts and boundary/audio intent in `edit-decision-list.json`.
- **Producer** assembles `episode-input.json` from Director's story plan and Editor's accepted decisions, compiles/verifies `video.md`, owns Markcut preview, same-Worker revision loop and generic + Video Director + Market reviews. **Final QA** independently verifies the approved revision and actual rendered video.
- No Stage may fabricate dialogue, location, movement, inner thought, observed footage or permissions. A real `INPUT_NEEDED` source manifest must be resolved before creating Episode Tasks.
- The Producer requires **interactive human approval of the latest canonical Markcut preview**; an AI PASS or successful render is not an approval. If the selected Worker cannot present that UI, report the capability blocker, not success. Human preview approval does not authorize publication.
- Publishing requires separate explicit owner authorization, platform-side evidence and a receipt. Private archive is the default. Independent Relay Final Review and retry remain separate from in-Worker revisions.

## Source, story and media

- Start with authorized original source media; preserve hashes and observed timestamps. Use Simplified Chinese for titles, narration and captions unless the Task specifies otherwise. Recognize Hey Neo editing instructions as source-linked commands; do not treat wake-word/command audio as story dialogue by default.
- One source-backed **story goal, ordered scene purposes and outcome** is required before compilation. Optional GPS/local-event research belongs to Director, not a new Stage. Follow [story, route and sound contract](docs/story-first-route-sound.md). Never invent a recorded route from sparse GPS; no GPS is a valid complete episode.
- Private previews may retain accurate GPS from approved source media without a second production gate. **Before public distribution**, confirm that the owner's publication authorization covers the exact locations shown; otherwise remove/obscure sensitive place identifiers or hold publication. Do not silently export exact private coordinates.
- Every episode needs one continuous **template-selected** main BGM by default. For private preview, do not gate on catalog license verification or silently substitute another song. If the actual chosen track is missing, report the unavailable asset rather than generate a stand-in. Preserve useful source ambience, duck under speech, review transitions in actual playback and do not manufacture synthetic footage as filmed evidence. The [executable Markcut template](templates/cinematic-vlog.md) defines BGM selection; its entry is not a license. Final publication holds until intended audio usage rights are verified.
- Shared capabilities own media ingestion, TTS, image/video generation, CapCut, Markcut, specialist reviews and post adapters; discover relevant Skills on demand. Optional media tools follow [tool selection and authorization](docs/optional-media-tools.md) only when useful; CapCut cloud uploads, mutations and paid generation require separate approval. The current run's source evidence, canonical Markcut `video.md`, reviews and final output remain authoritative.

## Project quality evals

Use `.evals/cases.json` with `neo eval run --project vlog`. Every Vlog Worker role needs a capability case; the Producer also requires an executable `template-verify` case that tests the canonical Markcut template, selected song, compilation and actual rendering. Eval evidence stays under ignored `.evals/reports/`. Decision PASS never substitutes for video playback, owner approval or Final QA.

## Artifact and review authority

All work stays inside the dated private `runs/<episode>/` root. Director/Editor/Producer output names and revision hash dependencies are in the [stage contract](docs/episode-stage-contract.md). `runs/` is Git-ignored; no public source material belongs in a prompt or repository. Reviewers evaluate the current preview/source evidence and return actionable changes rather than rebuilding the project style from prose. Instantiate the [Markcut Markdown template](templates/cinematic-vlog.md) only when the story fits it; the Markcut DSL and actual playback determine supported cuts, audio, effects and captions.
