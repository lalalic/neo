# Neo Harness Rust Migration Constitution

## Core Principles

### I. Observable CLI Compatibility
For each migrated command, the Rust entry point MUST preserve documented arguments,
stdout/stderr semantics, JSON shapes, exit codes, path resolution, and user-visible failure
behavior. Intentional changes MUST be separately specified and tested, not silently
introduced during a language port.

### II. Capability Ownership
Harness MUST own only CLI orchestration, bootstrap/discovery, Project and Run setup,
and delegated local execution coordination. Agents Relay, Models, NeoY, and other
established services MUST retain their own runtime state and authority. Harness
MUST federate instead of duplicating a service or exposing a second trust boundary.

### III. Safe User-Owned Data
Private Projects, Run Git, credentials, temporary inference artifacts, and local
configuration MUST remain user-owned and must not be written to the public Harness
repository or silently migrated. Filesystem traversal and symlink safety MUST be at
least as restrictive as the current implementation.

### IV. Test-First, Slice-by-Slice
Each ported CLI capability MUST have baseline fixture tests from the Node.js
reference, negative cases, and direct Rust integration tests before replacement.
A command is migrated only after parity is demonstrated independently from
the previous implementation. Do not claim success from compilation alone.

### V. Small Stable Core, Dynamic Extensibility
Core Harness dispatch MUST be a distributable native executable. Markdown
Agents, Skills, and Contracts remain versioned content, not compiled behavior.
Dynamic JS/Python/browser skills MAY retain their existing runtimes when explicitly
invoked; the core command paths MUST not require a Node.js interpreter.

## Migration Constraints
- Maintain the existing command namespace and settings paths.
- Keep the stable Node.js command as the production default until replacement
  passes acceptance; never create dual sources of truth for state.
- Preserve Project Git roots, per-Run private Git, agent selection and event delivery.
- The feature branch is `rust`; the canonical `main` worktree and live Neo.app
  installation are not modified by this migration until explicitly released.

## Quality Gates
- Capture reference behavior and error fixtures before implementing a command.
- Run Rust unit/integration tests and matching Node.js fixture comparisons.
- For stateful commands, verify one real Project/Run lifecycle including failure
  recovery, without modifying existing user Runs.
- Document explicit unsupported commands in the Rust preview CLI; fail rather than
  silently proxy through Node.js or report an action as complete.

## Governance
This constitution supplements the root `AGENTS.md`, which remains authoritative
for project source, permissions, and user work. Amendments require a documented
rationale, an updated version/date, and a compatibility impact review. Breaking
policy changes increment MAJOR, additions MINOR, clarifications PATCH. Every
implementation review checks this constitution and the root `AGENTS.md`.

**Version**: 1.0.0 | **Ratified**: 2026-11-23 | **Last Amended**: 2026-11-23
