---
name: chatgpt-browser-worker
description: Reliably submit ChatGPT browser-worker tasks through the authenticated browser-harness session while preserving Project/thread identity, operation-scoped tabs, prompt-defined output contracts, and optional result inspection.
---

# ChatGPT browser worker

This skill is the browser-backed ChatGPT worker contract for Neo. It uses the
existing `browser-harness` command as its only browser interaction layer. It
does not use the MacBridge ChatGPT runtime, ChatGPT APIs, copied cookies, or a
second browser automation stack.

## Capability contract

The worker boundary exposes these lifecycle operations:

```text
create(project, prompt, thinking_level) -> ThreadState
temporary(prompt, thinking_level, files[]) -> ThreadResult
resume(thread_id, project)             -> ThreadState
send(thread_id, project, prompt, files[]) -> ThreadState
status(thread_id)                      -> StatusObservation
result(thread_id, expect_json=false)   -> ThreadResult
delete(thread_id)                      -> DeletedThreadState
```

`project.name` is required when creating or resuming a thread. `project.id` is
optional because the UI may not expose it at every boundary. The adapter must
select and verify that Project before sending the first prompt. A resumed
thread keeps its recorded Project identity; callers cannot silently move it to
another Project.

Thinking levels are split into `requested_thinking_level` and
`effective_thinking_level`. Requested values are `default`, `low`, `medium`,
and `high`; effective values may additionally be `unknown`. `default` leaves
the account's current/default setting unchanged. The adapter must preserve
`unknown` rather than guessing from a label or silently downgrading a request.

`temporary` is the clean one-shot path for tasks such as media/vision analysis
that need one prompt and one final answer but no Project-held context. It always
creates a fresh operation-owned tab, enables Temporary Chat, optionally uploads
files, waits for the final assistant message, returns that verified result, and
closes the tab. It has no Project binding or persisted lifecycle state and must
not be resumed/reopened. An explicit retry starts a new Temporary Chat.

## Prompt-defined output contract

The browser worker owns reliable submission, not the task's completion semantics. Every asynchronous or delegated task prompt must explicitly define its durable output contract. The output mechanism is task-specific and remains part of the prompt; this skill does not force a universal callback, result file, event, or tool.

Examples of valid output contracts include:

- update a managed PR/job/task with summary, evidence, commit, and terminal state;
- write a report or structured result to a specified file;
- commit code and record the commit in the owning task;
- emit a named event after durable artifacts are written;
- call a task-specific or generic tool;
- perform a custom combination of these actions.

The prompt should identify the authoritative output destination/action and success evidence. For asynchronous tasks, the ChatGPT conversation itself must not be the only durable output unless the caller explicitly chooses conversation text as the output contract.

A recommended prompt shape is:

```text
Task:
<task instructions>

Output contract:
<task-specific durable output requirements>
```

The browser worker must submit that prompt exactly as task input and verify a durable user turn. Once submission is verified, the worker may close its operation-owned tab. The owning orchestrator observes completion using the mechanism declared in the prompt.

## Durable identity and state

Persist the returned state after every successful lifecycle transition. The
durable key is the ChatGPT `thread_id`; a URL, title, or browser tab index is
not an identity. Records retain a deleted thread as a tombstone so a stale
caller cannot recreate or accidentally reuse it. The complete JSON schema and
valid transition table are in [references/contract.md](references/contract.md).

Pure validation and transition helpers live in `scripts/contract.py`, with
focused tests in `tests/test_contract.py`. The browser-harness driver is
intentionally injected through the semantic port described in the reference;
the contract layer does not import or launch `browser-harness`.
Run `python3 -m pytest skills/chatgpt-browser-worker/tests` from the repository
root.

For the Neo/Leo and Agents Relay handoff—task IDs, run-local state, event
ownership, and the create/resume/result/delete invocation sequence—see
[references/orchestration.md](references/orchestration.md). The outer
orchestrator may use MacBridge as a transport, but this worker never treats
MacBridge as the ChatGPT runtime.

The runtime entry point is the
[browser-worker agent](agents/browser-worker.agent.md). Callers launch that
agent with a typed lifecycle intent; they must not directly call
`create_bh.py` or `operate_bh.py`. Those scripts are helper implementations
that the agent may use, repair, or bypass while preserving this skill's
browser-harness and verification contract.

The browser-worker agent's `create` intent starts a new ChatGPT chat when the
attached tab is already a conversation and emits JSON with the observed
`thread_id`, conversation URL, selected Project, and thinking observation.
`scripts/create_bh.py` is only a helper for that agent, not a caller-facing
runtime contract.

For implementation/debugging, the agent may use the helper equivalent for an
existing thread with the durable identity from persisted state:

```text
python3 scripts/operate_bh.py resume --thread-id ID --project NAME
python3 scripts/operate_bh.py continue --thread-id ID --project NAME --prompt TEXT
python3 scripts/operate_bh.py send --thread-id ID --project NAME --file image.png --file clip.mp4 --prompt TEXT
python3 scripts/operate_bh.py status --thread-id ID --project NAME
python3 scripts/operate_bh.py result --thread-id ID --project NAME --expect-json
python3 scripts/operate_bh.py delete --thread-id ID --project NAME
```

Each command performs one serial browser-harness operation. The injected
semantic adapter in `scripts/operations.py` is the testable boundary; it does
not import MacBridge or a ChatGPT runtime API.

## Browser tab ownership

Each lifecycle operation owns only the browser tabs it creates. Before the operation returns—whether it succeeds, fails, or is blocked—it must close every tab it created. It must never close or interact through a tab that existed before the operation started. `create` and `temporary` always start from a fresh owned tab; they may never click New chat, select a Project, type, upload, or submit in a user's existing tab. Durable worker state is the ChatGPT `thread_id`; a browser tab must never be treated as persistent state or intentionally left open for a later operation. Every `send`/follow-up operation must open its own fresh tab for the exact durable thread; it must never send from a pre-existing or shared user tab. That send tab is operation-owned and must be closed before return.

## Verification boundary

Before an existing thread is used, the worker must wait for the user-browser page to be fully ready: document load complete, exact `thread_id` observed in the URL, recorded Project observed, and real conversation UI hydrated. A send additionally requires a visible composer before any upload or typing. A navigation event or sidebar shell alone is not readiness.

For media work, callers use the typed `send` operation rather than touching browser file inputs directly. `send` must observe every requested attachment in the composer, submit the prompt, and verify that a new durable user turn appeared before it reports success.

`result` remains an optional conversation-inspection operation; it is not the universal completion channel. When a task's prompt explicitly chooses conversation text as its output, the worker may report `completed` only from an observed assistant message and normalized result. When `expect_json` is requested, the final text must parse as JSON; truncated prefixes are failures, not completion. A process exit, click, URL change, or tab title alone is not
proof that a thread was created, resumed, completed, or deleted. Authentication
walls, MFA, consent, ambiguous account/project selection, and unverified
thinking levels are `blocked` or `failed` conditions and must not be
self-healed.

Delete targets the exact durable conversation URL, requires an observed action
and confirmation, and verifies that the requested thread is no longer visible.
Repeated cleanup is idempotent (`not_found` is accepted); archive/undo UI
controls are evidence only and never revive a deleted tombstone.

Keep credentials, prompts containing private data, and browser runtime state
out of durable state and events. Runtime artifacts belong under the caller's
ignored `runs/` directory.
