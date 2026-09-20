# Neo/Leo orchestration integration

This skill is a worker capability, not an orchestrator or a browser session
manager. The `browser-worker` agent owns adaptive browser execution. Agents
Relay (or Leo's owning orchestrator) owns the task, correlation ID, retries,
events, and durable run location. The worker owns one ChatGPT thread state
record. `browser-harness` is the only layer that touches the authenticated
browser.

## Responsibility split

| Layer | Responsibility | Must not do |
| --- | --- | --- |
| Agents Relay / Leo | Create the child task, pass the exact `job_id` and `task_id`, consume lifecycle events, and reconcile terminal state | Select DOM elements, infer a thread from a tab, or replace a deleted thread |
| Browser-worker agent | Load both skills, execute typed lifecycle intents, adapt to ordinary UI drift by re-observing, preserve `thread_id`/Project identity, and return verified observations | Bypass authentication, MFA, consent, ambiguity, or unverifiable results |
| This skill | Validate requests, preserve `thread_id` state, enforce Project and status transitions, and normalize observed results | Launch a second browser stack, call a ChatGPT API, or depend on MacBridge as a ChatGPT runtime |
| `browser-harness` adapter | Perform the observable browser actions and return semantic observations | Persist orchestration state, invent success from a process exit, or hide authentication/ambiguity failures |

MacBridge may be the transport used by an outer Leo deployment to start a
worker, but it is not part of this ChatGPT runtime path. A local worker can
invoke `browser-harness` directly. No MacBridge ChatGPT MCP tool, copied
cookie, or ChatGPT API is required.

## Task handoff

The parent creates one child task with the same `job_id` and a task-specific
`task_id` (nested work also receives `parent_task_id`). The task input contains
an operation request and a run-local state path; it does not contain browser
credentials or cookies:

```json
{
  "job_id": "neo-chatgpt-browser-worker-20260919",
  "task_id": "chatgpt-thread-1",
  "operation": "create",
  "state_path": "runs/2026-09-19-chatgpt-thread/state.json",
  "request": {
    "project": {"name": "neo"},
    "prompt": "Task:\nRun the assigned task.\n\nOutput contract:\nUpdate the owning task with durable result evidence and terminal state.",
    "thinking_level": "high"
  }
}
```

The exact literal IDs must be present in both the worker environment and its
prompt. Runtime state, prompts containing private data, logs, and browser
session details stay under the caller's ignored `runs/` directory.

## Output ownership

The task prompt defines how the ChatGPT worker publishes its final output. The browser-worker does not prescribe one universal completion channel.

Examples:

```text
Output contract:
- Update Agents Relay task <task_id> with summary, commit, tests, artifacts, and terminal state.
```

```text
Output contract:
- Write the complete report to docs/reviews/<name>.md.
- That file is the authoritative result.
```

```text
Output contract:
- Write valid JSON to runs/<run_id>/result.json.
- Emit task.completed only after the file is durable and schema-valid.
```

Submission and completion are separate concerns. The browser-worker verifies submission and closes its owned tab. The owning orchestrator waits/reconciles according to the prompt-defined output contract, which may use Agents Relay state, files, commits, events, tools, or custom mechanisms.

## Lifecycle invocation

The orchestrator launches the `browser-worker` agent with one serial typed
operation at a time and persists the returned state before acknowledging
success. It must not directly invoke `create_bh.py` or `operate_bh.py`; those
are agent implementation helpers. The durable identity is always the
`thread_id` in `state.json`, never a URL, title, or tab index.

| Intent | Request | Browser-port calls | Success evidence |
| --- | --- | --- | --- |
| Start | `create` with `project`, `prompt`, `thinking_level` | `select_project` → optional `set_thinking_level` → `send_prompt` | observed non-empty `thread_id` and Project |
| One-shot | `temporary` with `prompt`, `thinking_level`, optional `files[]` | new owned tab → Temporary Chat → prompt/files → wait final assistant message → close tab | verified final assistant message; no Project or persisted state |
| Reattach | `resume` with `thread_id`, `project` | `open_thread` and Project verification | opened matching thread and Project |
| Inspect conversation output (optional) | `result` with the durable state | `read_result` | normalized assistant message with `message_id`; authoritative only when the prompt selects conversation output |
| Clean up | `delete` with the durable state | exact-thread delete plus confirmation | verified `deleted` or idempotent `not_found` |

`status`/`result` are optional conversation-inspection operations, not the default orchestration completion loop.
`temporary` is deliberately outside the durable lifecycle: it is never resumed, reopened, deleted, or automatically retried. An explicit retry starts a completely new Temporary Chat invocation.
`continue` is a follow-up prompt operation and is not a substitute for
`resume`. A retry resumes the existing state; it never calls `create` for a
missing or failed browser action. A `deleted` tombstone is terminal.

The pure entry points are `create_thread`, `resume_thread`, `result_thread`,
and `delete_thread` in `scripts/create.py` and `scripts/operations.py`. The
`*_bh.py` scripts are thin helpers the agent may call or replace while running
one operation through `browser-harness`; they are not an alternate state store,
orchestrator, or caller-facing runtime.

## Events and terminal handling

The owning orchestrator emits `task.started`, meaningful milestones, and one
terminal task event using the shared events-bus contract. A worker should
report routine success as `task.completed` with `visibility: orchestrator`;
the parent then reconciles the state file and emits the user-visible result.
Failures involving login, MFA, consent, ambiguous Project selection, or an
unverified result are `task.failed` or `task.blocked`, not successful relay
completion. Event payloads contain IDs, statuses, and evidence summaries—not
credentials, cookies, or full private prompts.

## Minimal relay loop

```text
watch(job_id)
construct prompt with explicit task + output contract
submit through browser-worker
verify durable user turn
close operation-owned tab
observe/reconcile the output mechanism named in the prompt
mark parent task terminal only from that durable evidence
```

Use `status`/`result` only when conversation inspection is explicitly required by the task/output contract.

The browser adapter may fail after a thread has been created. In that case,
preserve the last known `thread_id` and state, classify the transition as
`failed` or `blocked`, and let the orchestrator decide when to retry `resume`.
