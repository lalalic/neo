---
name: xchat-orchestrator
description: Orchestrate a closed-loop coding task through a GitHub pull request and a local Codex worker on the user's Mac. Use when the active XChat assistant should inspect, implement, review, revise, validate, and optionally merge repository changes.
---

# XChat Orchestrator

Use this skill when the user invokes `@orchestrator` or asks the current XChat assistant to drive a repository task through a pull request until it is merged, intentionally closed, blocked, or awaiting a user decision.

The active XChat assistant owns the loop. The local Codex process is the implementation worker. GitHub is the durable process state. DevMacBridge is the control channel for local execution and authenticated `gh` writes.

## Session project binding

At session start, follow `xchat-bootstrap.md`. When Project/Space instructions provide `xchat_project`, resolve it with `scripts/list-xchat-projects --resolve <xchat_project>` before project-dependent work. Use the returned `local_path` as the project context root and read its existing `AGENTS.md` / `README.md`; do not require a separate XChat metadata file or central JSON registry. Keep the resolved project/repository binding sticky for the conversation unless the user explicitly switches it.

## Capability discovery

At the start of each orchestration task, discover the currently available local skills by running `~/Workspace/neo/skills/xchat-orchestrator/scripts/list-xchat-skills --project <local_path>` when a project is bound. Project-local skills under `<local_path>/skills/` override same-named shared/global skills for that project. Select auxiliary skills from their names and descriptions, then read only the relevant `SKILL.md` files before planning or delegating work. Do not assume a fixed skill set and do not preload every skill body. Explicit `#skill-name` selections from the user take precedence.

## Operating invariants

- A PR represents one coherent top-level objective. Do not mix unrelated features in a new PR.
- **PR creation is durable job creation.** For repository work represented by a GitHub PR, create/reuse the top-level PR and its trusted `agents-relay:job:v1` marker through `agents-relay job create`. Adopt an existing unmanaged PR with `agents-relay job adopt`; repair a damaged/duplicate same-job marker with `agents-relay job repair`. Do not use raw `gh pr create`, GitHub UI/API, or another path to create the orchestrator's managed work PR.
- Draft/WIP PRs are still Agents Relay jobs. Draft status changes review readiness only and never bypasses durable job bootstrap.
- Before repository execution or worker launch, assert that the managed PR exists, the trusted Agents Relay job marker exists, and the exact `job_id` is known. If this cannot be established safely, stop rather than silently falling back to raw PR creation.
- After the top-level job exists, represent executable implementation, research, review, validation, and other delegated work as child tasks in that durable job and submit/manage them through Agents Relay.
- GitHub PR state, head SHA, checks, reviews, and comments are the workflow record. Do not require Google Drive, `HANDOFF.md`, `STATUS.md`, `STATE`, or a task directory for GitHub-backed work.
- Use GitHub tools for reads when available. Authenticated `gh` may be used for GitHub reads and lifecycle mutations not owned by Agents Relay, but creation/adoption/repair of an orchestrated PR/job must go through the Agents Relay CLI.
- Use the exact repository, branch, PR, job ID, and Codex thread resolved during preflight. Never guess among multiple local checkouts, jobs, or threads.
- Never expose secrets in PR descriptions, comments, metadata, logs, or commits.

## Closed-loop protocol

### Progress event contract

For delegated or background work that can outlive an immediate tool call, apply the `events-bus` skill. Create one `job_id` and establish the pre-launch watch capability before `job.started` or any worker: prefer non-blocking `events__watch(job_id)`; if unavailable, only for a newly-created unique job with no prior events, use `events__history(job_id, after_cursor=0, limit=1)` and start at cursor `0` when empty. Do not use that fallback for an existing/resumed job with an unknown cursor. The concrete order is establish cursor → model-router plus visible `model.selected` render → launch → `events__wait(job_id, after_cursor, ...)` loop; a blocking wait before launch is invalid. In worker instructions, request routine successful child `task.completed` as `visibility: orchestrator` while the parent reconciles/consumes results; use `visibility: user` only when completion is a meaningful standalone user milestone. Failed/blocked/cancelled task events and top-level terminal job events remain user-visible and immediate. Pass the exact literal `job_id` and task-specific `task_id` in both environment and prompt; nested work keeps the job ID and uses a new task ID plus `parent_task_id`. Sandboxed Codex workers publish through MCP `macdevbridge.events__publish`; direct non-sandbox workers may use the absolute `NEO_EVENTS_EMIT` helper. Proactively surface `visibility=user` milestones. After a wait returns a user-visible event, render its human-readable message before any next tool call, including another wait. Continue after `task.completed`; stop only on `job.completed|failed|blocked|cancelled` or abnormal worker death. If transport fails, emit the same structured event to stdout/stderr as fallback and report degraded observability; transport failure is not business success.

### Mandatory routing invariant

Before **every new agent/worker launch**, including implementation, research, review, evaluation, and independent or nested subagents, run `model-router` against the dynamically discovered usable profiles. Publish exactly one user-visible `model.selected` event in the same job before or as launch, with the actual selected model and thinking/reasoning level when known, otherwise `unknown`. Include the profile/provider in `data` when known. A persistent continuation of an already-bound worker thread preserves its sticky routing and needs no new routing event unless the thread is replaced, forked, or routing is explicitly reconsidered. A launch without a preceding observable routing decision is invalid and must fail the orchestration/eval.

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

Before creating a new Codex worker thread, apply the `model-router` skill. Dynamically discover the configured Codex profiles and select the weakest profile that comfortably satisfies the task. Treat already-paid subscription capacity and credits as positive routing signals; when quality and capability are materially equivalent, prefer suitable already-paid capacity such as the configured `zai` profile over consuming additional metered resources.

Record the selected worker profile, provider, and model in the orchestrator marker, for example:

```text
<!-- xchat-orchestrator:v1 {"repo":"owner/name","pr":1,"branch":"task/example","thread_id":"…","worker_profile":"zai","worker_provider":"zai","worker_model":"glm-5.3-flash","iteration":1,"state":"IMPLEMENTING","next":"review"} -->
```

Start a new worker with the selected profile using the installed CLI syntax, normally:

```text
codex exec -p <PROFILE> -C <REPO_OR_WORKTREE> <PROMPT> --json
```

The selected profile is sticky for the lifetime of that worker thread. Do not reroute on ordinary review/revision iterations or silently change the identity of a resumed thread. Reroute only when the bound profile is unavailable or exhausted, lacks a newly required capability, is demonstrably inadequate after a failed cycle, or the user explicitly requests a switch. If rerouting requires a different profile, fork or create an appropriate new worker thread and record why continuity was broken.

For independent jobs, route independently. For example, implementation may use `zai` while a separate high-risk architecture or review job may use a stronger configured profile. Do not hard-code provider choices beyond explicit user policy; the router must still discover and gate candidates dynamically.

The `model.selected` event is the launch observability contract; use the actual model and thinking level from the router result and never infer unavailable values.

### 3. Start or resume Codex

Prefer the noninteractive continuation path for background execution:

```text
codex exec resume <THREAD_ID> <PROMPT> --json
```

Use the installed CLI's help to confirm option placement and supported flags. Capture the final JSON response and a log file, then verify the worker's exit status, changed paths, tests, commit SHA, and push result. Use top-level interactive `codex resume` only when a verified PTY is available.

For a new task without a thread, start a new `codex exec` session and record its thread ID before the next iteration. Do not silently replace an existing thread. If the exact thread cannot be resumed after trying the supported noninteractive and PTY paths, explain the failure and ask before forking or creating a replacement.

Before starting a worker, acquire a per-PR run/lease marker. If another active run exists, or the PR head SHA changed since preflight, stop and re-read GitHub state rather than starting duplicate work.

### 4. Implement safely

Give Codex the objective, acceptance criteria, allowed scope, current PR head SHA, and required validation. The worker may inspect, edit, test, commit, and push only the task branch.

Require the worker to:

- Preserve unrelated files and changes.
- Stage explicit paths; never use `git add .` for a scoped task.
- Check `git diff --cached --name-only` against the allowed scope before committing.
- Avoid force-pushes, history rewrites, default-branch edits, and destructive cleanup.
- Report changed paths, validation results, commit SHA, and remote push status.

For a mixed historical PR, make an intent-level selective change. Do not revert an entire commit merely because it introduced the requested feature together with unrelated work.

The orchestrator may perform a small, mechanical recovery edit when worker transport is unavailable, but must apply the same scope, staging, validation, and reporting rules. Substantive implementation belongs to the Codex worker.

### 5. Reconcile and review

After every worker push, re-read the PR and verify the new head SHA. Compare the PR changed-file list, commits, checks, reviews, and unresolved threads with the local result. A successful command exit code alone is never evidence that the requested behavior is correct.

If a connector response appears stale or conflicts with the pushed SHA, reconcile through authenticated `gh` on the Mac before deciding. Do not review or merge an unverified patch.

Treat absent checks such as `statuses: []` as “no automated status reported,” not as passing validation. Run the repository's required local checks and identify any missing CI configuration.

Request revisions with concise, actionable comments tied to the current diff. Resume the same Codex thread for revisions whenever possible. Update the marker state and iteration after each loop boundary.

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
