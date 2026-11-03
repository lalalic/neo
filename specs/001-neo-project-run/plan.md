# Implementation Plan: Neo Project Run

**Branch**: `001-neo-project-run` | **Date**: 2026-11-03 | **Spec**: [spec.md](spec.md)

## Summary

Implement `neo project run` as a thin front-end to the existing Agents Relay CLI. Resolve the Neo root from workspace configuration, validate one declared project input, prepare private canonical run files, and create one shortcut Job followed by one Task using the unchanged project graph. Keep Relay as the only Job/Task authority.

## Technical Context

- **Language**: Node.js 22+ ES modules
- **Dependencies**: Node standard library and published `agents-relay@latest` CLI
- **Storage**: Ignored canonical project `runs/`; Relay owns Job and Task state
- **Tests**: Node built-in test runner with temporary workspaces and an injected Relay runner
- **Platform**: Neo CLI on the host selected by `loadWorkspaceConfig()`
- **Constraints**: No shell, REST, SQLite, duplicate graph/orchestrator, production run, task status database, URL leakage, or worktree media path
- **Scope**: Two opt-in project declarations, generic input-driven runner, one Job and Task per explicit run

## Architecture and Decisions

1. Reuse `loadWorkspaceConfig().neoRoot`; canonicalize Neo root, selected project, graph, and run directory. Reject a linked Git worktree root.
2. Require top-level project `AGENTS.md`, `README.md`, `graph.mmd`, and `project.run.json`. The declaration controls supported input; `graph.mmd` remains the only workflow ordering authority.
3. For HTTPS input, create a unique dated canonical run; store the complete URL in a private mode-0600 JSON evidence file. Keep the URL out of generated objective/task text, Relay argv, stdout, and stderr.
4. For path input, require an existing dated directory in the configured project's canonical `runs/`; reject traversal, outside symlinks, file paths, and deeper-than-series layout. Never replace existing run files.
5. Invoke `agents-relay job create --shortcut-execution`, then `agents-relay task create --agent-graph-file`. Task creation is Relay's wake path; do not call `job run`.
6. Write an atomic private binding after Job creation. A retry verifies Job and Task using Relay CLI; if the Job exists and the Task is missing, create that Task only. Never use the binding as status.
7. Keep `neo project list|resolve|setup-agent` on the existing route. Explicitly stage the new entrypoint so an installed CLI does not depend on its source checkout.

## Project Structure

```text
.bin/neo-project-run.mjs                 # validation, private artifacts, Relay argv
.bin/neo-control.mjs                     # project run route
.bin/neo.mjs                             # CLI help
scripts/stage-neo-cli.mjs                # explicit packaged entrypoint allowlist
docs/neo-project-run-contract.md         # authoritative cross-project contract
content-distribution/project.run.json    # HTTPS URL input declaration
vlog/project.run.json                    # canonical path input declaration
content-distribution/{AGENTS,README}.md  # rights and URL behavior
vlog/{AGENTS,README}.md                  # path behavior and watcher compatibility
test/neo-project-run.test.mjs            # isolated CLI and Relay-stub coverage
```

The initialized Spec Kit constitution file contains only unfilled placeholders. The governing constraints are the repository's root `AGENTS.md` and the canonical project run contract. No new dependency or additional state authority is introduced.

## Validation Gates

- Requirements checklist has no unresolved markers.
- Tests use temporary workspaces, stub Relay argv, and synthetic package staging only.
- `npm test` passes with the sibling Relay CLI override for existing prompt-builder evals.
- `git diff --check` passes; no production `runs/`, real Job store, or external service is touched.
