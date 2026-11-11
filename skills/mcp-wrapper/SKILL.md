---
name: mcp-wrapper
description: Integrate independent MCP providers into Neo with a one-file Node.js wrapper plus existing Neo.app Federation configuration.
---

# MCP wrapper

## Goal

Expose any independent MCP provider to Agents through Neo.app's unchanged
Federation boundary. A wrapped tool can perform Neo-owned orchestration while
preserving the original provider's Tool schema, UI metadata and Resources.
Agent Workers invoke **one Relay CLI command**: `agents-relay review interactive --path PATH --id JOB --task-id TASK --execution-id EXEC`. The CLI calls Neo `review.preview`; Agents do not call the lower-level tool directly. With `{path}`,
standalone requests are **view-only** (no controls, notification, Relay state,
or Git action). For a current Relay Task execution, the CLI supplies
`{path,relay:{jobId,taskId,executionId}}` using the authenticated Task execution
identity in Relay's context. The wrapper validates it with the existing
`review.interactive.begin` and waits for an actual decision. The tool call
returns a compile receipt; Relay's Task suspension and eventual resume are
asynchronous. Never infer approval from the receipt. No preview call creates
a Git commit. Markcut remains the media renderer; its original preview is independent of Relay.

For local single-file previews, the Neo Wrapper accepts supported image
(.png, .jpg, .jpeg, .webp, .gif), audio (.mp3, .wav, .m4a,
.aac, .flac, .ogg) and video (.mp4, .mov, .m4v, .webm) paths.
It writes one .ghost.markcut.md next to the media, then calls the
unchanged Markcut Tool. Images display for 5 seconds; audio/video durations and visual aspect ratios
come from ffprobe (visual dimensions capped at 1280px). The same adapter supports managed media review without a Git checkpoint.
New Run Git repositories ignore .ghost.* globally via Neo Run Git
info/exclude; never commit ghost media adapters.

## Markcut example

The single `markcut.mjs` wrapper routes `review.preview` through one `markcut.preview` invocation to the
original Markcut Server. For managed Relay Tasks it calls
`agents-relay review interactive ...` through **CLI**, not direct HTTP, to bind the running execution, put the Task in `AWAITING_DECISION`,
and recover from a failed render or notification. For standalone preview,
Relay is not called. In Relay-managed mode the authoritative waiting event is
**provider-neutral** (`task.interactive_waiting` with
`source.component: interactive-review`), not `neo-preview` or `markcut`.
The wrapper must reuse the exact execution binding and
Relay's canonical `task.interactive_decision` event template, with no separate invocation ID,
Git commit, revision, or snapshot. Decisions are deduplicated by the existing Task execution. A `review_requested`
receipt is not user approval or Task completion. Markcut owns preview media,
Core owns notification/InBox delivery, and Relay alone owns durable Review
state. Do not add a second Preview Provider. **Only Neo Wrapper validates Relay-specific
identity and constructs the event template.** Markcut and Neo Mobile/Core receive
a generic Events Bus envelope; they only validate transport safety, attach the
human response in the caller-designated field, and publish without inspecting
Task IDs or event types. It invokes Neo.app Core's loopback-only REST endpoint
`POST /mobile/review/notify` and persists the intent until Core confirms
Inbox storage. There is **no public notification-sending MCP Tool**.

Generate a machine-specific stdio Federation entry with:

```bash
node skills/mcp-wrapper/markcut.mjs --federation "$HOME/Workspace/markcut/scripts/launch-mcp.sh"
```

Install that URL under the existing Federation provider name `markcut`, not
in parallel with the original provider. `stdio-proxy.mjs` is a small reusable
transport helper; each new wrapped provider owns its own `*.mjs` file and
config. Keep MCP Apps UI descriptions, resource URIs and error statuses intact.

Run `node --test skills/mcp-wrapper/test/*.test.mjs` from the `neo` repo.
