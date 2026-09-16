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
