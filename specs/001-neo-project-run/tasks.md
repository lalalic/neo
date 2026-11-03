# Tasks: Neo Project Run

**Input**: Design documents in `specs/001-neo-project-run/`
**Prerequisites**: `spec.md`, `plan.md`, `research.md`, `data-model.md`

## Phase 1: Setup

- [X] T001 Add canonical cross-project execution and permissions contract in `docs/neo-project-run-contract.md`.
- [X] T002 Add declared URL and canonical-path input metadata in `content-distribution/project.run.json` and `vlog/project.run.json`.

## Phase 2: Foundational

- [X] T003 Implement project/input validation, private run artifacts, Relay argv delegation, and safe binding recovery in `.bin/neo-project-run.mjs`.
- [X] T004 Route `neo project run` and preserve legacy project commands in `.bin/neo-control.mjs` and `.bin/neo.mjs`.
- [X] T005 Add the run entrypoint to the explicit installed CLI allowlist in `scripts/stage-neo-cli.mjs`.

## Phase 3: User Story 1 - URL-backed run (Priority: P1)

**Goal**: Create private canonical runs from declared HTTPS source references and delegate through Relay.

**Independent Test**: Use a temporary Content Distribution fixture and injected Relay runner; confirm exact Job/Task argv, private token evidence, no token in output or argv, and safe output path.

- [X] T006 [US1] Add URL parsing, scheme/credential checks, private reference evidence, and zero-write dry-run coverage in `test/neo-project-run.test.mjs`.
- [X] T007 [US1] Document URL reference limitations and no implied license/publication permission in `content-distribution/AGENTS.md` and `content-distribution/README.md`.

## Phase 4: User Story 2 - Canonical path run (Priority: P1)

**Goal**: Use existing canonical Vlog run directories without replacing files and resume verified Relay work.

**Independent Test**: Use temporary Vlog fixtures with valid, traversal, symlinked, and repeated paths plus a Relay stub; confirm no duplicate Job/Task and successful missing-Task recovery.

- [X] T008 [US2] Add canonical path containment, traversal/symlink rejection, duplicate verification, failure recovery, and Task output-path coverage in `test/neo-project-run.test.mjs`.
- [X] T009 [US2] Document approved media and preserve the separate legacy watcher/Planner workflow in `vlog/AGENTS.md` and `vlog/README.md`.

## Phase 5: User Story 3 - Project contract and compatibility (Priority: P1)

**Goal**: Make declarations, policy, installed CLI behavior, and legacy routes understandable and consistent.

**Independent Test**: Inspect declaration and contract docs; run CLI help, project resolution, and staged package checks without a live Relay call.

- [X] T010 [US3] Link and require the run contract for content-producing projects in root `AGENTS.md`.
- [X] T011 [US3] Test `--help`, legacy project resolution, and packaged entrypoint inclusion in `test/neo-project-run.test.mjs`.
- [X] T012 [US3] Record invocation forms and isolated verification commands in `specs/001-neo-project-run/quickstart.md`.

## Phase 6: Polish and Verification

- [X] T013 Run full Neo tests, package staging verification, and final diff/contract review; record results in `specs/001-neo-project-run/quickstart.md`.

## Dependencies and Execution Order

- Setup (T001-T002) and Foundational (T003-T005) establish the contract and command surface before story behavior.
- User Story 1 and User Story 2 share the runner and Relay binding, so they are sequential in implementation; their isolated test scenarios are independent.
- User Story 3 documentation is independently reviewable after the contract exists.
- Different project documentation, declarations, and test scenarios were separable by file, but implementation was kept in one worktree and completed without parallel workers.

## Implementation Strategy

Deliver the URL and path flows together because they share one declaration-driven CLI and Relay recovery path. Tests use only temporary fixture workspaces and injected Relay subprocess behavior. No production execution is part of this source change.
