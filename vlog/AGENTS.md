# Vlog Agent Guide

Vlog is a Neo monorepo project. Root `AGENTS.md` applies first.

## Purpose

Turn real phone/desktop media and real Neo work into evidence-backed short-form vlog stories using NeoX for media access and Markcut for analysis, storyboard, preview, and rendering.

## Project boundary

- Reusable code, docs, routing config, templates, styles, series definitions, sanitized personas, and tests are tracked here.
- Every real production execution belongs under `runs/<series-name>/<YYYY-MM-DD[-slug]>/` and is ignored by Git.
- A run contains its own imported media, episode/storyboard, generated narration/BGM, workflow database, logs, previews, reviews, publish receipts, and final renders.
- Do not create tracked top-level `episodes/`, `runtime/`, `assets/`, `output/`, or instance-specific `data/` directories.
- Never commit personal media, voice recordings, private URLs/IDs, LAN addresses, local account paths, credentials, or unpublished content.

## Agent placement

Vlog currently does not require project-only role files. Reusable capabilities come from Neo `skills/` and installed local tools. If a Vlog-only role becomes durable, place it under `agents/<role>.md` and route it from this file.

## Run contract

Use one run root per production execution:

```text
runs/<series-name>/<YYYY-MM-DD[-slug]>/
├── source-manifest.json
├── assets/
├── vlog.md
├── state/
│   └── vlog.sqlite
├── generated/
├── review/
├── logs/
└── output/
```

A series can span many runs, but one run must not write into another run's directory. Promotion from `runs/` into tracked source requires explicit review and sanitization.

## Workflow

1. Gather/inspect real source media and record its provenance in the run.
2. Analyze only selected media needed for the requested story.
3. Build the run-local storyboard and audio plan.
4. Verify observable storyboard/render behavior rather than trusting command exit status.
5. Keep publication separate and require explicit authorization through `skills/post`.

## Project learnings

- 2026-09-12: Verify service discovery and the actual handoff API separately. Bonjour advertisement can succeed while required queue endpoints are still missing.
- 2026-09-12: A shared handoff worker must validate Vlog intent before claiming a queue item; peek first so it does not consume another producer's work.
- 2026-09-12: An empty, correctly filtered media search is a valid auditable outcome. Do not invent a Vlog or widen the user's requested time window just to produce content.
- 2026-09-16: Keep one production execution self-contained in its dated run. Splitting episodes, SQLite state, renders, logs, and publish receipts across top-level folders makes provenance and cleanup harder.
