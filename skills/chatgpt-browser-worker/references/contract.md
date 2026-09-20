# ChatGPT browser-worker contract

This document is the stable boundary between Neo orchestration and a
`browser-harness` adapter. It is intentionally independent of ChatGPT's DOM,
URL layout, or internal network calls.

## Requests

All requests contain an operation and no credentials:

```json
{
  "operation": "create",
  "project": {"name": "neo", "id": "project-optional"},
  "prompt": "Run the assigned task.",
  "thinking_level": "high"
}
```

`create` requires `project.name`, `prompt`, and `thinking_level`.
`resume` requires `thread_id` and `project`; its thinking level is optional and
defaults to the persisted request. `continue` requires `thread_id`, `project`, and `prompt`. `send` additionally accepts `files[]` and must verify that each requested attachment is observed before submit and that a new durable user turn exists after submit. `status`, `result`, and `delete` require only `thread_id`.

Allowed requested thinking levels are `default`, `low`, `medium`, and `high`.
The adapter may expose a current UI label in an observation, but it must map it
to one of these values or `unknown` rather than guessing.

## Prompt-defined completion semantics

The prompt carries the task-specific output contract. The browser-worker protocol deliberately does not define a mandatory completion mode such as callback tool, event, result file, or conversation polling.

For delegated/asynchronous work, the prompt MUST state the durable output destination or action and what constitutes success. Examples include updating an Agents Relay PR/job/task, writing a file, committing code, emitting an event, calling a tool, or a custom combination.

`send` success means **submission succeeded**: the exact prompt/attachments became a verified durable user turn. It does not mean the task itself completed. After verified submission, the operation-owned send tab may be closed immediately. The owning orchestrator is responsible for observing the task-specific completion mechanism declared in the prompt.

`result` is optional and is only authoritative when the prompt/output contract explicitly designates conversation output as the result channel.

## Durable thread state

The state file is the only persisted worker identity. It may look like:

```json
{
  "schema_version": 1,
  "thread_id": "chatgpt-conversation-id",
  "conversation_url": "https://chatgpt.com/c/chatgpt-conversation-id",
  "project": {"id": "project-id", "name": "neo"},
  "status": "awaiting_result",
  "requested_thinking_level": "high",
  "effective_thinking_level": "high",
  "created_at": "2026-09-19T12:00:00Z",
  "updated_at": "2026-09-19T12:01:00Z",
  "last_error": null
}
```

Required fields are `schema_version`, `thread_id`, `project.name`, `status`,
`requested_thinking_level`, and `effective_thinking_level`. `project.id` and
`conversation_url` are optional because the UI may not expose them at every
boundary, but the adapter must preserve them when observed.

The only valid statuses are:

| Status | Meaning |
| --- | --- |
| `created` | identity exists; no prompt has been sent yet |
| `running` | a prompt was sent and work is in progress |
| `awaiting_result` | the UI indicates a response may be read |
| `completed` | an assistant result was observed and normalized |
| `failed` | the operation failed; recovery may resume this identity |
| `blocked` | human/authentication/ambiguity decision is required |
| `deleted` | cleanup was verified; identity must not be reused |

Valid transitions are:

```text
create -> created -> running -> awaiting_result -> completed
                                      |              |
                                      +-> failed     +-> running (follow-up)
any live state -> blocked
any live state -> deleted  (only after verified cleanup)
failed/blocked -> running  (only after an explicit recovery operation)
```

`deleted` is terminal. A new conversation gets a new `thread_id`.

## Results

```json
{
  "thread_id": "chatgpt-conversation-id",
  "status": "completed",
  "text": "The assistant's normalized final answer.",
  "message_id": "observed-message-id",
  "observed_at": "2026-09-19T12:02:00Z"
}
```

`text` is required only for a completed conversation-result observation. Partial or streaming text is not a completed conversation result. A result with no observed assistant message is an error, not success. This result object does not override a prompt-defined external completion contract.

## Browser adapter port

The adapter is tested through a fake port with these semantic calls:

```text
select_project(project) -> observed_project
open_thread(thread_id) -> observed_thread
set_thinking_level(level) -> observation
send_prompt(prompt) -> observation
send_with_attachments(prompt, files[]) -> verified_user_turn_observation
read_status() -> status_observation
read_result() -> result_observation
delete_thread() -> cleanup_observation
```

`cleanup_observation` must contain the requested `thread_id` (or omit it only
when the browser has verified the thread is absent), `outcome` equal to
`deleted` or `not_found`, and `verified: true`. `not_found` is a successful
idempotent retry. Archive/undo controls may be reported as observational
metadata, but they do not turn a delete into a recoverable state: a deleted
tombstone remains terminal and must never be reused.

These names describe the boundary, not a required Python class or browser
selector implementation. Each call must return observed values or a typed
failure. The contract layer must remain usable with a fake port and must not
import or launch `browser-harness` itself.

## Browser tab ownership

- An operation owns only tabs it creates.
- Every owned tab must be closed before the operation returns, including success, failure, and blocked outcomes.
- Tabs that existed before the operation started must never be closed.
- Durable thread state must not depend on a browser tab remaining open.
- Every `send` and `continue` operation MUST open a fresh operation-owned tab for the exact durable thread, even if another tab already displays that thread. Sending from a pre-existing/shared user tab is forbidden.
- The send tab must be closed before the operation returns.
- Opening the exact durable thread in a temporary tab is permitted for other operations; that temporary tab must be closed after the observation or action completes.
- Reopening is not complete at navigation time. The worker must wait until the user browser reports a fully loaded document, exact thread identity, recorded Project, and hydrated conversation UI. `send`/`continue` additionally require a visible composer.

## Testable safety boundaries

- no request can omit the Project on `create` or `resume`;
- Project IDs are compared when both browser boundaries expose them; a
  name-only observation remains valid because the UI may hide opaque IDs;
- no state can omit a non-empty `thread_id` or valid status;
- `resume` rejects an observed Project mismatch;
- requested and effective thinking levels are distinct fields;
- unknown effective level stays `unknown`;
- only an observed assistant message yields a completed conversation-result observation; task completion may instead be established by the prompt-defined durable output contract;
- attachment send success requires a verified durable user turn, not a click or attachment preview alone;
- callers may require JSON output, in which case malformed or truncated JSON is rejected;
- delete is terminal and cannot be followed by resume;
- browser, login, and ambiguity failures preserve the thread identity and are
  classified as `failed` or `blocked`.
