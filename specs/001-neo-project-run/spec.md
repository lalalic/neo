# Feature Specification: Neo Project Run

**Feature Branch**: `001-neo-project-run`
**Created**: 2026-11-03
**Status**: In Progress
**Input**: User request to expose canonical project runs through existing Agents Relay CLI.

## User Scenarios & Testing

### User Story 1 - Start a URL-backed content run (Priority: P1)

As a content operator, I can pass an HTTPS source URL and project name to Neo, so a private canonical run is created and delegated through the project's existing graph.

**Why this priority**: This is the primary new explicit entry point for URL-based content work.

**Independent Test**: Use a temporary configured Neo workspace and a stub Relay executable; verify the private run evidence, exact Relay argv, and safe output without external effects.

**Acceptance Scenarios**:

1. **Given** a project that declares HTTPS URL input, **When** I run `neo project run --url="$PRIVATE_SOURCE_URL" --project=content-distribution`, **Then** Neo creates private dated run evidence and delegates one shortcut Job and one graph Task.
2. **Given** a URL with a query token, **When** I run the command, **Then** the complete URL is stored only in a mode-0600 private evidence file and is absent from output and Relay argv.
3. **Given** `--dry-run`, **When** I provide valid input, **Then** Neo reports a safe preview without creating files or invoking Relay.

### User Story 2 - Start or resume a canonical path run (Priority: P1)

As a project operator, I can select an existing dated run in the configured canonical project's `runs/` tree, so its existing media remains in place and Relay execution can be resumed safely.

**Why this priority**: Existing Vlog media already arrives through a separate watcher; explicit task creation must use those canonical artifacts without copying them.

**Independent Test**: Use temporary project trees with valid, invalid, and symlinked run paths plus a stub Relay executable; verify containment, idempotency, and recovery.

**Acceptance Scenarios**:

1. **Given** a project declaring canonical path input, **When** I run `neo project run --path=/absolute/canonical/vlog/runs/YYYY-MM-DD-episode --project=vlog`, **Then** Relay receives references to that run and its unchanged canonical graph.
2. **Given** a successful binding already exists, **When** I repeat the same path, **Then** Neo verifies the Job through Relay and returns the same identifiers without creating duplicate work.
3. **Given** a Job was created but its Task was not, **When** I repeat the path, **Then** Neo verifies the Job and creates the missing Task under that Job.

### User Story 3 - Preserve the Neo Project contract (Priority: P1)

As a project owner, I can understand each project's supported input, canonical run rules, and approval gates from the project contract and README.

**Why this priority**: A generic CLI must not imply permissions or silently replace existing project workflows.

**Independent Test**: Review the root contract, both project guides, machine-readable declarations, and README examples for consistency.

**Acceptance Scenarios**:

1. **Given** a project that has no run declaration, **When** it is selected, **Then** the CLI rejects it rather than inferring input support.
2. **Given** a URL source, **When** content distribution receives it, **Then** the project treats it only as an acquisition reference and still requires applicable rights and explicit publication permission.
3. **Given** the Vlog watcher workflow, **When** documented beside explicit `neo project run`, **Then** it remains a backward-compatible legacy ingress path and its Planner behavior is not described as migrated.

## Edge Cases

- Reject absent/conflicting input flags, unknown options/projects, malformed HTTPS URLs, URL credentials, control characters, missing project contract files, and malformed declarations.
- Reject traversal, symlink escape, non-directory, non-dated, media-file, and noncanonical/worktree run paths.
- Preserve existing run contents and diagnostics on Relay failure; do not cancel Jobs or overwrite private artifacts.
- If binding exists, verify the Job via Relay before reporting success; if verification fails, stop without duplicating the Job.
- If `--dry-run` is selected, validation may read workspace/project configuration but must not write or spawn.

## Requirements

### Functional Requirements

- **FR-001**: CLI MUST accept `neo project run` URL and path forms with either `--flag=value` or `--flag value`, any option order, `--help`, and `--dry-run`.
- **FR-002**: CLI MUST resolve projects from configured `loadWorkspaceConfig().neoRoot`, validate real paths and required `README.md`, `AGENTS.md`, `graph.mmd`, and reject unknown or escaping projects.
- **FR-003**: Each eligible project MUST declare one supported input type and restrictions in project-owned machine-readable metadata; projects without a declaration MUST be rejected.
- **FR-004**: URL input MUST be HTTPS without credentials or control characters. The source URL MUST be private evidence and MUST NOT be printed or passed in Relay argv.
- **FR-005**: URL input MUST create a unique dated canonical private run with restrictive file permissions and task/objective files that refer to the evidence file rather than embed the source URL.
- **FR-006**: Path input MUST be an existing dated run directory under the selected canonical project's `runs/`; it MUST reject traversal, symlink escapes, media files, other projects, and detached worktrees.
- **FR-007**: CLI MUST create a create-only shortcut Job with repository default `lalalic/neo` (overridable by `NEO_RELAY_REPOSITORY`), then create one Task using the project's existing canonical graph. It MUST NOT invoke `job run`.
- **FR-008**: CLI MUST persist an atomic private Job/Task binding and resume a verified Job missing its Task without creating a duplicate.
- **FR-009**: CLI MUST avoid replacing existing run files, preserve failed-run diagnostics, and never claim Relay Job/Task completion based on a local binding.
- **FR-010**: CLI MUST display only project, safe run path, and verified Job/Task identifiers; it MUST not leak source tokens through output or logs.
- **FR-011**: `--dry-run` MUST perform no writes and no subprocess calls.
- **FR-012**: Existing `neo project list`, `resolve`, and `setup-agent` routes MUST remain functional.
- **FR-013**: Documentation MUST define the cross-project run contract and distinguish explicit CLI runs from legacy watcher/Planner flows and project approval requirements.

## Key Entities

- **Project Run Declaration**: Project-owned input type and validation restrictions used by the generic CLI.
- **Canonical Run**: Private dated project execution directory containing references, objective/input documents, output, and recovery binding.
- **Relay Binding**: Private pointer to a Relay Job and stable Task ID; not an execution status store.

## Success Criteria

### Measurable Outcomes

- **SC-001**: All valid URL and path invocations accept both option syntaxes and delegate exactly one Job plus one Task on first execution.
- **SC-002**: Invalid, escaping, or unsupported input creates zero Relay calls; dry-run creates zero writes and zero Relay calls.
- **SC-003**: Repeated path input creates no duplicate Job or Task after Relay confirms the binding.
- **SC-004**: Automated tests cover the URL secret boundary, canonical path containment, recovery, CLI compatibility, and staging.
- **SC-005**: `npm test` and isolated package staging complete successfully without invoking production services or touching canonical runs.

## Assumptions

- Relay CLI output for successful create/show/list commands is JSON and its existing published command is `agents-relay`.
- Relay's Task creation wakes the daemon; Neo therefore creates the Task but does not separately run the Job.
- The isolated worktree's configured workspace for tests is a synthetic temporary Neo workspace.
- `content-distribution` is URL-input capable; `vlog` is canonical-path capable; no other project is enabled by inference.
