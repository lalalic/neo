# Neo Drama

An explicit, resumable asset-producing pipeline for 《桃桃醒来的第一个晚上》. Story, world, character, episode, shot, continuity, and prompt files are durable project assets. Specialist agents make domain decisions, providers execute generation, Markcut owns timeline/rendering, and independent reviewers gate state transitions.

The orchestration contract is documented in [`docs/workflow.md`](docs/workflow.md) and machine-readable in [`config/workflow.json`](config/workflow.json). Provider boundaries remain in [`config/providers.json`](config/providers.json).

## Commands

```bash
./drama.sh status
./drama.sh workflow
./drama.sh audit-run <run_id>
./drama.sh prepare
./drama.sh generate concept
./drama.sh generate tts --episode ep01 --line line01
./drama.sh generate shot --episode ep01 --shot shot01
./drama.sh render
./drama.sh render --episode ep01 --media
```

`status` reports episodes, manifest state, Agnes credential source, workflow version, and whether configured specialist agents are actually installed under `~/.codex/agents`.

`workflow` prints the full stage → specialist → executor → reviewer contract and agent availability.

`audit-run <run_id>` checks that durable run/episode state obeys the configured core state machine; external delivery may be recorded, but it must never change the Drama core state beyond `APPROVED`.

`prepare` validates story, character, location, episode, shot, continuity, and Markcut storyboard contracts. Episode IDs are extensible (`ep01`, `ep02`, …); the project is no longer limited to exactly three episodes.

`generate` writes artifact sidecars and skips valid existing outputs unless `--force` is passed. Generated videos are probed with `ffprobe` before a generation stage is marked succeeded; sidecars record size and SHA-256. A shot may set `continuity_from` to an earlier shot, causing the previous shot's final frame to become the next image-to-video input.

`render` compiles configured episode storyboards. `render --media --episode ep01` delegates that episode to Markcut and validates the resulting video before recording success.

All real production content—series/story state, characters, locations, episodes, prompts instantiated for a run, generated media, caches, reviews, and outputs—lives under `runs/<run-id>/` and stays out of Git. The tracked project contains only the reusable engine, contracts, scripts, routing configuration, and workflow documentation.

## Production model

1. **story** — `narrative-designer`, reviewed by `narratologist`.
2. **concept** — `image-prompt-engineer` → Agnes image, reviewed by `brand-guardian`.
3. **dialogue** — `narrative-designer` → local `mlx-audio`, reviewed for edit/audio fit.
4. **shot** — `image-prompt-engineer` + continuity guidance → Agnes video, reviewed by `evidence-collector`.
5. **assembly/edit** — `short-video-editing-coach` → Markcut, evidence reviewed independently.
6. **episode QA** — `reality-checker` decides from deterministic and observable evidence.
7. **optional external delivery** — outside the Drama core state machine, `studio-operations` may hand an APPROVED artifact to a channel adapter such as `wechat-bro`; MP4/video uses `send-video`, and destination-side verification creates a separate delivery receipt.

The top-level XChat orchestrator owns lifecycle and Event Bus consumption. Agent selection happens before model selection; `model-router` chooses the concrete worker model/profile for new delegated work.

## State and evidence

The workflow deliberately separates three concerns:

- `runs/<run_id>/*.json`: durable business state — what is true now.
- Event Bus: live telemetry — what is happening now.
- `runs/<run-id>/generated/manifest.json` + artifact sidecars: provenance — what artifacts were produced and validated.

Do not equate command completion with business success. In particular:

```text
generated != accepted
rendered  != approved
sent      != delivered
```

Repairs stay inside the same run and top-level `job_id`; repair the smallest failed stage and preserve accepted upstream artifacts.

## Creating the next episode

A request such as “generate 004” means starting an `ep04` production run, not directly calling Agnes. The orchestrator should inspect `status` and `workflow`, create one run/job, route story creation to the configured specialist agents, append `ep04` to `runs/<run-id>/story/series.json`, create the episode's durable files, then move through generation, QA, and approval. If delivery is explicitly requested, start a separate channel-adapter job from the approved artifact.

See [`docs/workflow.md`](docs/workflow.md) for Mermaid diagrams of the routing layers, state machine, continuity chain, QA loop, Event Bus lifecycle, and delivery verification flow.

## Boundaries

- TTS uses local `mlx-audio`.
- Image/video understanding uses local `mlx-vlm`.
- Image and video generation use Agnes only.
- Timeline compilation and rendering use Markcut only.
- Drama production ends at APPROVED. Review delivery is an optional external adapter workflow; social publication is separate again.
- Social-platform publishing still requires explicit authorization and the separate publishing workflow.
