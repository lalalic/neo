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

At the start of each orchestration task, discover the currently available local skills by running `~/Workspace/neo/skills/xchat-orchestrator/scripts/list-xchat-skills`. Select auxiliary skills from their names and descriptions, then read only the relevant `SKILL.md` files before planning or delegating work. Do not assume a fixed skill set and do not preload every skill body. Explicit `#skill-name` selections from the user take precedence.

## Operating invariants

- A PR represents one coherent objective. Do not mix unrelated features in a new PR.
- GitHub PR state, head SHA, checks, reviews, and comments are the workflow record. Do not require Google Drive, `HANDOFF.md`, `STATUS.md`, `STATE`, or a task directory for GitHub-backed work.
- Use GitHub tools for reads when available. Route PR mutations through authenticated `gh` on the Mac when the GitHub connector is read-only or returns a permission error.
- Use the exact repository, branch, PR, and Codex thread resolved during preflight. Never guess among multiple local checkouts or threads.
- Never expose secrets in PR descriptions, comments, metadata, logs, or commits.

## Closed-loop protocol

### Progress event contract

For delegated or background work that can outlive an immediate tool call, apply the `events-bus` skill. Create one `job_id` and subscribe to `neo.events.job.<job_id>.>` before starting the worker. Pass the correlation variables in the environment **and include the exact literal `job_id` and task-specific `task_id` in the worker prompt**; never write only `inherited` or a placeholder. Sandboxed Codex workers must publish task events through MCP `macdevbridge.events__publish`; Direct non-sandbox workers may use the absolute `NEO_EVENTS_EMIT` helper. Proactively surface `visibility=user` milestones while the worker runs. After an event wait returns a user-visible event, emit its human-readable assistant progress message before making the next tool call; another `events__wait` may only happen after that visible message. A background log or tool-call trace that the user cannot read as progress is not a progress report. Always surface blocked/failure states, terminal results, and resource-release events such as `phone.released` immediately.

### 1. Resolve and preflight

Resolve the canonical `owner/name`, PR number, head branch, local repository root, and task worktree. Verify that the local remote and branch match the PR. If any target is ambiguous, stop and ask.

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

Recognize legacy `<!-- chatgpt-orchestrator:v1 ... -->` markers from older runs. When continuing such a task, preserve their recorded state and migrate the marker to `xchat-orchestrator:v1` on the next metadata update rather than creating a duplicate.

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

## Recovery and stopping rules

- Retry transport failures without counting them as implementation iterations.
- Count failed implementation/review cycles. After three unsuccessful iterations using one approach, change approach or ask the user.
- Stop for ambiguous scope, repository or branch mismatch, missing credentials, permission failure, unexpected concurrent changes, unsafe/destructive consequences, or inability to validate.
- If the bridge is unhealthy, report the exact failing capability and do not pretend the worker ran.
- Do not change global Codex approval or sandbox settings merely to force a run.
## Completion report

At each loop boundary, report the PR URL/number, state, head SHA, worker thread, validations, unresolved risks, and next action. At termination, state clearly whether the PR was merged, intentionally closed, blocked, awaiting the user, or left ready for merge.
