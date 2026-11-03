# Data Model

## Project Run Declaration

- `schemaVersion`: required integer `1`.
- `input.type`: required `url` or `path`.
- URL declaration: `input.schemes` must include `https`; runtime also rejects credentials and control characters.
- Path declaration: `input.path.base` is `runs`; `input.path.datedRunDirectory` is `true`.
- Scope: one declaration per enabled project, located at `<project>/project.run.json`.

## Canonical Run Artifacts

- `source-reference.json`: full private source URL, or canonical source run path reference; created with mode `0600`.
- `neo-project-run.objective.md`: Relay Job objective, references private input paths without embedding URL content.
- `neo-project-run.input.md`: Task input with selected canonical run and project contract references.
- `neo-project-run.result.json`: Relay file output destination inside the selected run.
- `.neo-project-run.json`: atomic recovery pointer containing `schemaVersion`, project, canonical run path, Job ID, stable Task ID, and private artifact paths; mode `0600`.

All run artifacts belong under the canonical project's ignored `runs/`. The pointer does not contain status or completion claims.
