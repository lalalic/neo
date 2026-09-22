---
name: xchat-orchestrator
description: Orchestrate a closed-loop coding task through a GitHub pull request and a local Codex worker on the user's Mac. Use when the active XChat assistant should inspect, implement, review, revise, validate, and optionally merge repository changes.
---

# XChat Orchestrator

Use this skill when the user invokes `@orchestrator` or asks the current XChat assistant to drive a repository task through a pull request until it is merged, intentionally closed, blocked, or awaiting a user decision.

The active XChat assistant owns the top-level objective. Agents Relay owns managed worker launch, wait, recovery, and reconciliation. GitHub is the durable PR/job record, DevMacBridge is the local control channel, and `events-bus` is the correlated progress stream.

## Session project binding

At session start, follow `xchat-bootstrap.md`, including its mandatory reads of the Agents Relay task/job contract and orchestrator workflows before any project binding. When Project/Space instructions provide `xchat_project`, resolve it with `scripts/list-xchat-projects --resolve <xchat_project>` before project-dependent work. Bind the returned project identity, `local_path`, `git_root`, and `repo` once and inherit that exact context into every managed task and executor. Read the applicable `AGENTS.md` / `README.md`; do not require a separate XChat metadata file or central JSON registry. Keep the binding sticky unless the user explicitly switches project/path/repository.

## Capability discovery

At the start of each orchestration task, discover the currently available local skills by running `~/Workspace/neo/skills/xchat-orchestrator/scripts/list-xchat-skills --project <local_path>` when a project is bound. Project-local skills under `<local_path>/skills/` override same-named shared/global skills for that project. Select auxiliary skills from their names and descriptions, then read only the relevant `SKILL.md` files before planning or delegating work. Do not assume a fixed skill set and do not preload every skill body. Explicit `#skill-name` selections from the user take precedence.

## Operating invariants

- One top-level objective maps to one GitHub PR and one Agents Relay job. Do not mix unrelated objectives in one managed PR/job.
- **PR creation is durable job creation.** For repository work represented by a GitHub PR, create/reuse the top-level PR and its trusted `agents-relay:job:v1` marker through `agents-relay job create`. Adopt an existing unmanaged PR with `agents-relay job adopt`; repair a damaged/duplicate same-job marker with `agents-relay job repair`. Do not use raw `gh pr create`, GitHub UI/API, or another path to create the orchestrator's managed work PR.
- Draft/WIP PRs are still Agents Relay jobs. Draft status changes review readiness only and never bypasses durable job bootstrap.
- Before repository execution or worker launch, assert that the managed PR exists, the trusted Agents Relay job marker exists, and the exact `job_id` is known. If this cannot be established safely, stop rather than silently falling back to raw PR creation.
- After the top-level job exists, represent executable implementation, research, review, validation, and other delegated work as child tasks in that durable job and submit/manage them through Agents Relay.
- A request to create a PR Job to perform an objective means create-and-start by default: prefer Agents Relay's create-and-start path, or use separate create plus submit when needed, then route a worker, submit at least one executable child task, and begin managed execution/reconciliation. Only an explicit create-only/no-execution request may leave a new OPEN job with zero tasks.
- Managed execution is submitted to Agents Relay; the orchestrator must not run a parallel launch/wait/recovery loop for the same task.
- Every managed child inherits the bound project identity, `local_path`, `git_root`, and `repo`; children do not independently re-resolve context.
- Every new managed worker is routed through `worker-router` first, using dynamically discovered usable worker capabilities and fresh Agents Relay resource facts when available. Then run `model-router` only against candidates usable by the selected worker. Do not encode provider/model/worker preference order or a concrete identity in this orchestration contract.
- **Browser ChatGPT worker output is fixed at task creation.** When `chatgpt-browser-worker` is selected for a child task, read that skill before creating the child and include exactly one declared durable output in the task prompt: either **task/PR output** with the exact managed task/PR identity and required final action, or **file output** with the exact authoritative file path. Do not launch the Browser ChatGPT worker without this declaration, and do not leave the worker to choose its own output destination. Progress and terminal success/failure still use the normal event contract; events are not a third output mode.
- GitHub PR state, head SHA, checks, reviews, and comments are the workflow record. Do not require Google Drive, `HANDOFF.md`, `STATUS.md`, `STATE`, or a task directory for GitHub-backed work.
- Use GitHub tools for reads when available. Authenticated `gh` may be used for GitHub reads and lifecycle mutations not owned by Agents Relay, but creation/adoption/repair of an orchestrated PR/job must go through the Agents Relay CLI.
- Use the exact repository, branch, PR, job ID, and Codex thread resolved during preflight. Never guess among multiple local checkouts, jobs, or threads.
- Never expose secrets in PR descriptions, comments, metadata, logs, or commits.

## Closed-loop protocol

### Progress event contract

For managed work, Agents Relay owns the lifecycle loop: pre-launch observation, routing metadata, worker launch, wait, retry/recovery, and reconciliation. The orchestrator submits correlated work and consumes/renders Relay's `events-bus` stream; it must not duplicate those lifecycle operations with a second direct worker loop.

Relay must satisfy the `events-bus` ordering contract for every new worker: establish observation before launch, apply `worker-router`, publish one truthful user-visible `worker.selected` event, apply `model-router` constrained to that worker, publish the existing truthful user-visible `model.selected` event with the actual model/thinking level when known, launch the worker, then reconcile progress and terminal state. Keep one literal `job_id` for the objective and one task-specific `task_id` per child. Routine successful child completion stays `visibility: orchestrator` while the parent reconciles; failed/blocked/cancelled tasks and top-level terminal events remain user-visible. If transport degrades, surface the structured fallback and do not claim delivery.

### Mandatory routing invariant

Before **every new agent/worker launch**, including implementation, research, review, evaluation, and independent or nested subagents, run `worker-router` against task requirements, discovered worker capabilities, and available resource facts. Publish exactly one user-visible `worker.selected` event before model routing, with only observed worker/decision facts. Then run `model-router` against models usable by that worker and publish exactly one user-visible `model.selected` event with the actual model and thinking/reasoning level when known, otherwise `unknown`. A persistent continuation preserves its sticky worker and model routing and needs no new routing events unless replaced or explicitly reconsidered. A new-worker launch without both ordered decisions is invalid and must fail the orchestration/eval.

### 1. Resolve and preflight

Resolve the canonical `owner/name`, local repository root, and intended top-level objective first. For repository work, resolve or bootstrap the durable Agents Relay job before implementation:

1. If no work PR exists, use `agents-relay job create` to create/reuse the PR and trusted job marker.
2. If an unmanaged work PR already exists, use `agents-relay job adopt`.
3. If a managed PR has a damaged/duplicate same-job marker, use `agents-relay job repair`.
4. If it is already managed, load and reuse its existing `job_id`.

Then resolve the exact PR number, head branch, and task worktree. Verify that the local remote and branch match the PR and that the trusted `agents-relay:job:v1` marker exists. If any target or durable job identity is ambiguous, stop and ask.

Repository layout may contain nested Git repositories, especially under `~/Workspace/neo/<repo>`. Treat the innermost checkout whose configured remote matches the target `owner/name` as the repository root. Never infer the root merely from the first parent directory containing `.git`, and never run child-repository Git mutations from the outer `~/Workspace/neo` repository.

For local repository discovery, use this order:

1. An explicit path supplied by the user or already recorded for the task.
2. A clean exact match found by remote URL under the user's normal workspace roots, including both `~/Workspace/<repo>` and `~/Workspace/neo/<repo>`.
3. If starting from an arbitrary cwd, inspect candidate nested repositories and compare their remotes to `owner/name`; do not accept a parent checkout whose remote does not match.

Use `git -C <repo_root> ...` for all repository operations after resolution so later cwd changes cannot silently switch the target repository. When creating an isolated worktree, create it from the resolved child repository, not from an enclosing repository.

Before mutation, check:

- PR state, base branch, head SHA, body, changed files, commits, reviews, unresolved threads, and checks.
- `git status --porcelain=v2 -b`, remote URL, current branch, and current commit.
- Mac bridge health, including the existence of the configured PTY helper rather than trusting a boolean health flag alone.
- `gh auth status` and read access to the target repository.
- The selected Codex executable, profile/model, and supported continuation commands.

If the PR body is empty or lacks an objective, scope, non-goals, acceptance criteria, validation commands, or merge policy, add or request that information before implementation.

Prefer a fresh isolated worktree for the worker. Use an existing checkout only when it is clean or the user explicitly authorizes dirty-worktree operation. Do not automatically stash, reset, clean, or overwrite unrelated changes.

### 2. Establish PR metadata

Maintain one small machine-readable marker in a PR comment or body. Update the existing marker instead of creating duplicates:

Recognize pre-XChat orchestrator v1 metadata markers from older runs by their recorded fields and schema. When continuing such a task, preserve the recorded state and migrate the marker to `xchat-orchestrator:v1` on the next metadata update rather than creating a duplicate.

```text
<!-- xchat-orchestrator:v1 {"repo":"owner/name","pr":1,"branch":"task/example","thread_id":"…","iteration":1,"state":"IMPLEMENTING","next":"review"} -->
```

The marker may contain repository, PR, branch, thread ID, iteration, state, next action, run/lease ID, and the selected worker profile/provider/model. It must not contain credentials, tokens, or private configuration. Treat the exact recorded thread ID and worker profile binding as authoritative.

Use these workflow states when communicating progress:

- `IMPLEMENTING`
- `REVIEW_REQUESTED`
- `CHANGES_REQUESTED`
- `VALIDATING`
- `READY_TO_MERGE`
- `BLOCKED`
- `AWAITING_USER`
- `MERGED`
- `CLOSED`

Do not use GitHub's broad `open` state as proof that implementation is active, approved, or ready to merge.

### 2.5 Route new worker execution

Before every new managed worker, apply `worker-router` to task requirements and discovered usable worker capabilities first. Use fresh shared resource/usage facts when available; do not duplicate provider readers or select a model. Publish the worker decision, then apply `model-router` only to candidates usable by that worker. Do not add orchestration-specific provider/model/worker ordering.

Record the selected worker profile, provider, and model in the orchestrator marker, for example:

```text
<!-- xchat-orchestrator:v1 {"repo":"owner/name","pr":1,"branch":"task/example","thread_id":"…","worker_profile":"<profile>","worker_provider":"<provider>","worker_model":"<model>","iteration":1,"state":"IMPLEMENTING","next":"review"} -->
```

Submit the task through Agents Relay with the selected routing metadata and the already-bound repository/project context. Adapter-specific launch commands belong to Relay and its adapters, not this orchestrator contract.

The selected profile is sticky for the lifetime of that worker thread. Do not reroute on ordinary review/revision iterations or silently change the identity of a resumed thread. Reroute only when the bound profile is unavailable or exhausted, lacks a newly required capability, is demonstrably inadequate after a failed cycle, or the user explicitly requests a switch. If rerouting requires a different profile, fork or create an appropriate new worker thread and record why continuity was broken.

Route independent tasks independently. Preserve explicit user provider/model instructions when present; otherwise rely on dynamic discovery and the router's generic policy.

The ordered `worker.selected` then `model.selected` events are the launch observability contract. Use actual router decisions and never infer unavailable worker, model, capability, resource, or thinking values.

### 3. Start or resume a managed worker

Relay creates or resumes the worker using the adapter selected for that task and records the durable thread/binding when one exists. The orchestrator does not call adapter-specific launch or resume commands for managed work.

Do not silently replace an existing persistent thread. If a continuation cannot be resumed, Relay must record the failure and justification before a replacement is created or routing is reconsidered.

Before managed execution, Relay enforces the task/job lease and correlation state. If another active execution exists, or the PR head changed since preflight, reconcile authoritative state rather than launching duplicate work.

### 4. Implement safely

Give the managed worker the objective, acceptance criteria, allowed scope, current PR head SHA, and required validation. The worker may inspect, edit, test, commit, and push only the task branch.

For a child executed through `chatgpt-browser-worker`, the handoff is incomplete until the prompt also contains the required output declaration from that skill (`task/PR` or `file`). This decision belongs to the orchestrator at child-task creation time.

Require the worker to:

- Preserve unrelated files and changes.
- Stage explicit paths; never use `git add .` for a scoped task.
- Check `git diff --cached --name-only` against the allowed scope before committing.
- Avoid force-pushes, history rewrites, default-branch edits, and destructive cleanup.
- Report changed paths, validation results, commit SHA, and remote push status.

For a mixed historical PR, make an intent-level selective change. Do not revert an entire commit merely because it introduced the requested feature together with unrelated work.

The orchestrator may perform a small, mechanical recovery edit when managed worker transport is unavailable, but must apply the same scope, staging, validation, and reporting rules. Substantive implementation belongs to the managed worker.

### 5. Reconcile and review

After every worker push, re-read the PR and verify the new head SHA. Compare the PR changed-file list, commits, checks, reviews, and unresolved threads with the local result. A successful command exit code alone is never evidence that the requested behavior is correct.

If a connector response appears stale or conflicts with the pushed SHA, reconcile through authenticated `gh` on the Mac before deciding. Do not review or merge an unverified patch.

Treat absent checks such as `statuses: []` as “no automated status reported,” not as passing validation. Run the repository's required local checks and identify any missing CI configuration.

Request revisions with concise, actionable comments tied to the current diff. Resume the same managed worker thread for revisions whenever possible. Update the marker state and iteration after each loop boundary.

### 6. Complete according to merge policy

Use an explicit merge policy for each task:

- `ask`: stop at `READY_TO_MERGE` and report the exact merge action.
- `auto_when_checks_pass`: merge only after the user has authorized this policy, required checks pass, no blocking threads remain, and the PR is mergeable.

Never merge around required checks or review rules. Never force-push or modify the default branch directly. Other terminal outcomes are intentional close, blocked, or awaiting user decision.

### 7. Verify post-merge package publication

After **every merged PR**, inspect the repository's GitHub Actions workflows for an npm publication path (for example a workflow that runs `npm publish`, publishes through npm provenance, or otherwise releases the repository's npm package). If no npm-publish workflow exists, record that the check is not applicable.

When an npm-publish workflow exists:

- identify the package name and expected version from the merged repository state; do not guess from the PR title or branch;
- verify the post-merge publish workflow/run reached its expected terminal state;
- query the npm registry for the published package version and compare it with the merged package version;
- treat a missing, stale, or mismatched registry version as an unresolved post-merge release issue and report the exact workflow/run and observed npm version;
- do not report the orchestration as fully complete until this publication check has been performed, even though the PR itself is already merged.

Use the public registry/package metadata for verification rather than trusting a successful local build or a workflow trigger alone.

## Recovery and stopping rules

- Retry transport failures without counting them as implementation iterations.
- Count failed implementation/review cycles. After three unsuccessful iterations using one approach, change approach or ask the user.
- Stop for ambiguous scope, repository or branch mismatch, missing credentials, permission failure, unexpected concurrent changes, unsafe/destructive consequences, or inability to validate.
- If the bridge is unhealthy, report the exact failing capability and do not pretend the worker ran.
- Do not change global Codex approval or sandbox settings merely to force a run.
## Completion report

At each loop boundary, report the PR URL/number, state, head SHA, worker thread, validations, unresolved risks, and next action. At termination, state clearly whether the PR was merged, intentionally closed, blocked, awaiting the user, or left ready for merge. For a merged PR, also report whether npm publication was applicable and, when applicable, the expected merged package version, observed npm registry version, and publish-workflow result.
