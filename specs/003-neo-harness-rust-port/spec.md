# Feature Specification: Port Neo Harness Core to Rust

**Feature Branch**: `rust`

**Created**: 2026-11-23

**Status**: Ready for implementation

**Input**: User requested a dedicated Rust branch for Neo Harness and a Spec Kit
workflow to begin porting. Previously agreed scope: core CLI and execution
infrastructure only; leave Markdown skills and dynamic scripts editable.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Reliable Core Discovery and Bootstrap (Priority: P1)

As a developer or agent on a Mac with Neo installed, I can obtain the same
bootstrap instructions, skill catalog, agent definitions and workspace
information from a self-contained native command even when a JavaScript
runtime is absent.

**Why this priority**: These commands are the entry points for every agent
session, are read-only, and provide a safe first independent migration slice.

**Independent Test**: On the same workspace, invoke the reference and
candidate commands in text and JSON modes; compare their structured output,
ordering, errors, and exit status. The candidate must also work without
an available Node.js interpreter.

**Acceptance Scenarios**:

1. **Given** a configured Harness with shared and global Skills, **when**
   a new agent starts, **then** the bootstrap contains the same rules,
   resolved skill identities, absolute paths, availability and ordering.
2. **Given** an existing project and agent catalog, **when** I list or search
   agents or skills, **then** matches, precedence and filters stay unchanged.
3. **Given** missing required files or invalid arguments, **when** the
   command is called, **then** it fails clearly without fabricating results.

---

### User Story 2 - Safe Native Project and Run Lifecycle (Priority: P2)

As a Neo Project owner, I can discover, resolve and initiate the same private
Project Runs with the existing Git, file boundary and Relay ownership rules.

**Why this priority**: Run coordination is central to Harness, but stateful and
security-sensitive; it follows read-only discovery.

**Independent Test**: Use a disposable independent Project fixture and validate
project resolution, input binding, Run Git, delegated execution, and
failure recovery without touching private production Runs.

**Acceptance Scenarios**:

1. **Given** a valid independent Git Project, **when** I resolve or start a
   Run, **then** state, input and delegated execution match the current CLI.
2. **Given** a nested path, symlink escape, malformed graph or invalid
   Project, **when** the command runs, **then** unsafe access is rejected.
3. **Given** cancellation, interruption or a failed delegated execution,
   **when** the command terminates, **then** existing recoverable Run
   state remains intact and no duplicate Job is created.

---

### User Story 3 - Complete Native Core Distribution (Priority: P3)

As a Neo.app user, I can install the managed Harness and use all core CLI
commands without installing Node.js, while still invoking opt-in script-based
Skills and external runtimes when needed.

**Why this priority**: This is the final distribution outcome; it depends on
parity across the earlier slices and native runtime integration.

**Independent Test**: Run the release CLI smoke matrix on a fresh supported
Mac with Node.js absent, then invoke one JS-based Skill through its explicit
runtime and confirm understandable dependency diagnostics.

**Acceptance Scenarios**:

1. **Given** a clean supported Mac, **when** Harness is installed, **then**
   built-in commands run without Node.js.
2. **Given** a script-based extension, **when** its runtime is unavailable,
   **then** the extension reports its own missing dependency without breaking
   core bootstrap and discovery.

### Edge Cases

- Duplicate skill/agent names across project, shared, global and Agency locations.
- A skill's required dependency is missing or a Skills directory is inaccessible.
- Workspace configuration or optional Project paths are missing or malformed.
- User input includes spaces, Unicode, relative paths, symlinks or option-looking values.
- A command is not yet ported in the preview binary; it fails explicitly.
- Multiple agents invoke read-only commands simultaneously during a CLI upgrade.
- An interrupted Run does not leave a partially published or contradictory state.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Harness MUST provide a side-by-side candidate executable on a
  dedicated branch without changing the production command or private Runs.
- **FR-002**: Migrated commands MUST retain existing argument syntax, output
  schema, content ordering and documented error behavior.
- **FR-003**: Harness MUST construct bootstrap content using authoritative
  rules and dynamically resolved skill definitions.
- **FR-004**: Harness MUST preserve project/global/shared agent discovery,
  precedence, filtering and search behavior.
- **FR-005**: Harness MUST keep shared resources separate from private
  Project repositories and their Run histories.
- **FR-006**: Harness MUST delegate durable Job execution to the existing
  execution owner without storing conflicting state.
- **FR-007**: Harness MUST reject traversal, unsafe paths, invalid Project
  declarations and partial/ambiguous input.
- **FR-008**: A production cutover MUST require independently verified
  compatibility and an explicit release decision.
- **FR-009**: Core commands MUST run without a general-purpose scripting
  runtime after cutover; script-based extensions MAY require one.
- **FR-010**: Unsupported preview commands MUST fail clearly rather than
  reporting success or silently delegating to a legacy implementation.

### Key Entities

- **Harness Installation**: Versioned CLI, shared Agents/Skills and config root.
- **Workspace**: User-configured discovery root, independent of a Harness checkout.
- **Definition**: Agent or Skill identified by name, source, file path,
  precedence and required capability.
- **Project**: Independent Git root with required declarations and graph.
- **Run**: Private Project-owned input binding, Git history and delegated
  execution identity.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of selected first-slice reference cases have matching
  structured fields, ordering and exit status under the candidate CLI.
- **SC-002**: First-slice native commands complete on a Mac with Node.js
  removed from PATH and no Node.js subprocess launched.
- **SC-003**: All defined invalid-input and absent-resource tests reject
  safely without corrupting an existing Project or Run.
- **SC-004**: Before cutover, 100% of the documented core CLI smoke matrix
  passes with direct native execution, including at least one verified
  Project Run and recoverable failure.
- **SC-005**: Existing users' configuration and private Run data require
  zero manual conversion or destructive reset.

## Assumptions

- Rust is the required implementation language for the core executable.
- This feature includes only the `@lalalic/neo` Harness repository; NeoY,
  Models, Relay and other existing Rust services are out of scope.
- Swift applications, versioned Markdown resources, and dynamic JS/Python
  scripts remain in their existing ownership boundaries.
- Phase 1 uses a parallel preview executable, not a production symlink swap.
- Preserving current behavior takes priority over incidental cleanup or new CLI features.
