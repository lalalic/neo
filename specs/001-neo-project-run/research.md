# Research: Neo Project Run

## Existing Relay CLI

- **Decision**: Reuse the installed/published `agents-relay` CLI via subprocess argv. Create Jobs with `job create --repo --project-path --objective-file --shortcut-execution`; create Tasks with `task create --repo --id --task-id --input-file --output file --output-path --agent-graph-file`.
- **Rationale**: Published CLI help and `specs/001-agent-shortcut-execution/quickstart.md` confirm this contract. Relay owns scheduling, async resume, checkpointing, fallback, review graph, and recovery.
- **Alternatives considered**: Direct REST/SQLite, a Neo scheduler, calling `job run`. All duplicate authority or could dispatch a second execution after Task creation.

## Project and Run Resolution

- **Decision**: Reuse `loadWorkspaceConfig().neoRoot`; canonicalize project, graph, `runs/`, and selected run paths before creating or reusing artifacts.
- **Rationale**: The installed CLI must work independently of its installation path and caller's working directory, while source worktrees must not become production run roots.
- **Alternatives considered**: Resolve relative to `process.cwd()` or the CLI module directory. Both can select the wrong checkout.

## Private input and recovery

- **Decision**: Keep complete URL input in a mode-0600 private evidence file; keep objective/input content URL-free. Use a mode-0600 atomic Job/Task binding pointer and verify existing state through Relay before reuse.
- **Rationale**: Query tokens must never appear in argv or output, and local state must not become another status authority.
- **Alternatives considered**: Put URLs in task text/argv, overwrite run evidence, or assume binding means the Job is healthy. These leak secrets, destroy evidence, or misreport status.

## Project contract scope

- **Decision**: Enable only Content Distribution URL input and Vlog canonical path input through project-local declarations and one authoritative root contract.
- **Rationale**: These are the requested project modes. The declarations describe accepted input only; `graph.mmd` and existing project permissions remain authoritative.
- **Alternatives considered**: Infer input support based on a project name or replicate graph/stage details in metadata. This would implicitly enable projects and create duplicate workflow configuration.
