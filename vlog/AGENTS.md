# Vlog — project execution policy

Vlog produces one evidence-grounded short-form episode from real, owner-authorized media. Root `AGENTS.md` and `MISSION.md` apply. The canonical stage input/output, revision and failure contract is [episode-stage-contract.md](docs/episode-stage-contract.md); load only the sections relevant to the assigned Stage.

## Explicit CLI run input

This project declares canonical run-path input in [project.run.json](project.run.json). `neo project run --path=/absolute/neo/vlog/runs/YYYY-MM-DD-episode --project=vlog` accepts only an existing dated run directory under this configured project's canonical `runs/`. Input media is supplied by the canonical run; template-asset preflight and Stage contract validation still apply. This explicit CLI path is separate from the legacy iCloud watcher and its Planner-backed Episode Jobs; those behaviors are unchanged.

## Planner topology

The [Graph](graph.mmd) is the only normal-stage ordering:

```text
Visioner -> vlog-director -> vlog-editor -> vlog-producer -> vlog-final-qa
```

Watcher/ingress runs outside the Graph. For the current Relay episode model, one Job owns the outcome; its initial Plan creates all five normal Stage Tasks with predecessor dependencies. Do not invent an empty parent Task, extra Graph nodes, review Tasks, or feedback edges. Task parentage expresses ownership, not the Graph. Later revision/recovery work is Relay-owned. Agents and adapter/model routes must resolve from the active execution context.

## Ownership and gates

- **Vlog Visioner** records observations, source IDs, source timecodes and uncertainties using Markcut; it does not select the story or edit clips.
- **Director** chooses a truthful goal, scene progression and payoff; writes `story.md`, `shot-selection.json`, `visual-brief.md` and `post.md`. **Editor** resolves source-linked in/out cuts and boundary/audio intent in `edit-decision-list.json`.
- **Producer** assembles `episode-input.json` from Director's story plan and Editor's accepted decisions, compiles/verifies `video.md`, owns Markcut preview, same-Worker revision loop and generic + Video Director + Market reviews. **Final QA** independently verifies the approved revision and actual rendered video.
- No Stage may fabricate dialogue, location, movement, inner thought or observed footage. A real `INPUT_NEEDED` source manifest must be resolved before creating Episode Tasks.
- The Producer requires **interactive human approval of the latest canonical Markcut preview**; an AI PASS or successful render is not an approval. If the selected Worker cannot present that UI, report the capability blocker, not success. Human preview approval does not authorize publication.
- Publishing and all permission/license audits are outside the creative DAG, to be handled by a separate publication-review workflow. Private archive is the default. Independent Relay Final Review and retry remain separate from in-Worker revisions.

## Source, story and media

- Start with original source media; preserve existing source IDs and observed timestamps without rehashing. Use Simplified Chinese for titles, narration and captions unless the Task specifies otherwise. Recognize Hey Neo editing instructions as source-linked commands; do not treat wake-word/command audio as story dialogue by default.
- One source-backed **story goal, ordered scene purposes and outcome** is required before compilation. Optional GPS/local-event research belongs to Director, not a new Stage. Follow [story, route and sound contract](docs/story-first-route-sound.md). Never invent a recorded route from sparse GPS; no GPS is a valid complete episode.
- Use only observed GPS for story decisions; publication-location review is outside the creative DAG.
- Every episode needs one continuous **template-selected** main BGM by default. Do not silently substitute another song. If the actual chosen track is missing, report the unavailable asset rather than generate a stand-in. Preserve useful source ambience, duck under speech, review transitions in actual playback and do not manufacture synthetic footage as filmed evidence. The [executable Markcut template](templates/cinematic-vlog.md) defines BGM selection; its entry is not a license. A separate publication-review workflow owns audio license decisions.
- Shared capabilities own media ingestion, TTS, image/video generation, CapCut, Markcut, specialist reviews and post adapters; discover relevant Skills on demand. Optional media tools follow [tool selection](docs/optional-media-tools.md) when useful; asset production is separate from publication review. The current run's source evidence, canonical Markcut `video.md`, reviews and final output remain authoritative.

## Project quality evals

Use `.evals/cases.json` with `neo eval run --project vlog`. Every Vlog Worker role needs a capability case; the Producer also requires an executable `template-verify` case that tests the canonical Markcut template, selected song, compilation and actual rendering. Eval evidence stays under ignored `.evals/reports/`. Decision PASS never substitutes for video playback, owner approval or Final QA.

## Artifact and review authority

All work stays inside the dated private `runs/<episode>/` root. Director/Editor/Producer output names and revision hash dependencies are in the [stage contract](docs/episode-stage-contract.md). `runs/` is Git-ignored; no public source material belongs in a prompt or repository. Reviewers evaluate the current preview/source evidence and return actionable changes rather than rebuilding the project style from prose. Instantiate the [Markcut Markdown template](templates/cinematic-vlog.md) only when the story fits it; the Markcut DSL and actual playback determine supported cuts, audio, effects and captions.

## Stage contract validation and self-healing

Every normal Stage and specialist reviewer calls `node scripts/validate-stage.mjs <stage> <absolute-run>` before reporting `task.completed`. This gate checks the Stage's deliverables, the existing JSON Schema through `agents-relay artifact validate`, and downstream references. On a failed validation, the **same Agent** repairs its own output and reruns validation before exiting. A failing Stage must send `task.failed` with the exact diagnostic and must not claim success. Do not rerun Visioner, parse original media again, recompute or compare source/music SHA-256 in subsequent Agents; use the validated Visioner source IDs and ranges. TTS is produced after Editor timings are known, not at project preflight.

Planner validates its Plan with the inherited Relay Planner contract. The project-run preflight validates **only assets declared by the selected template**: readable local file paths and syntactically valid HTTPS URLs, using `scripts/preflight-template-assets.mjs`. No asset library or public asset manager is introduced. All rights, licensing, publishing permissions and source-use authorization checks are outside all five creative Agents; a separate publication-review process will own those decisions. No Agent should publish media. This separation does not allow invented source speech, scenes or fabricated review approvals.
