# Vlog

Vlog turns real daily media/evidence into short videos. It is intentionally a thin Neo project: Agents Relay drives each production run, shared Neo skills perform specialized work, and this directory keeps only the Vlog contract plus ignored run artifacts.

## How it runs

The durable `vlog-autonomous` Agents Relay Job stays active. Each requested or scheduled episode is one durable Task, for example “create and publish the Vlog for 2026-09-26.” The Task may execute an internal Agent Graph for source selection, story/edit reasoning, render QA, and publishing. Durable child Tasks are only needed for independently reviewable or independently blocked outcomes.

Shared capabilities are discovered at runtime rather than reimplemented here:

- NeoX / phone-media capability — retrieve real phone photos/videos.
- shared visual-understanding and Markcut — understand media, edit, preview, and render.
- audio/TTS skills — narration, speech QA, BGM/SFX.
- `post` / `post-agent` — publish and verify Xiaohongshu and WeChat Channels.
- Agents Relay planner, troubleshooter, worker-router, model-router, lifecycle, and scheduling — execution control.

There is no Vlog-local workflow database, model-routing config, daemon/autopilot, Neo persona, Neo Build Log definition, generic documentary style, or travel-day template. Neo identity is inherited from root `MISSION.md`; Neo Build Log lives in its own project.

## Artifacts

Standalone/daily runs live at:

```text
runs/<YYYY-MM-DD[-slug]>/
```

A genuine named series may use:

```text
runs/<series-name>/<YYYY-MM-DD[-slug]>/
```

`runs/` is ignored and contains all selected/downloaded media, source manifests, Markcut sources, generated audio/video, reviews, logs, and publish receipts.
