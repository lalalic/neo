---
name: mcp-wrapper
description: Integrate independent MCP providers into Neo with a one-file Node.js wrapper plus existing Neo.app Federation configuration.
---

# MCP wrapper

## Goal

Expose any independent MCP provider to Agents through Neo.app's unchanged
Federation boundary. A wrapped tool can perform Neo-owned orchestration while
preserving the original provider's Tool schema, UI metadata and Resources.
The Agent invokes the tool **once**. Prefer `review.preview`: with `{path}`,
standalone requests are **view-only** (no controls, notification, Relay state,
or Git action). For a current Relay Task execution, supply
`{path,relay:{jobId,taskId,executionId}}` using the exact Task execution
identity in Relay's context. The wrapper validates it with the existing
`review.interactive.begin` and waits for an actual decision. The tool call
returns a compile receipt; Relay's Task suspension and eventual resume are
asynchronous. Never infer approval from the receipt. No preview call creates
a Git commit. Keep existing `markcut.preview` available for standalone
interactive reviews and legacy `review.relay` callers.

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
`agents-relay review interactive ...` through **CLI**, not direct HTTP, to bind
an Invocation, put the Task in `AWAITING_DECISION`, bind immutable revision,
and recover from a failed render or notification. For standalone preview,
Relay is not called. In Relay-managed mode the authoritative waiting event is
**provider-neutral** (`task.interactive_waiting` with
`source.component: interactive-review`), not `neo-preview` or `markcut`.
The wrapper must reuse the exact returned Invocation/Execution binding and
Relay's canonical `task.interactive_decision` event template, including
an invocation-specific opaque revision and idempotency. A `review_requested`
receipt is not user approval or Task completion. Markcut owns preview media,
Core owns notification/InBox delivery, and Relay alone owns durable Review
state. The existing 40-hex `commitSha` event field is a legacy transport slot
used as an opaque per-invocation token, not a Git commit. Do not add a
second Preview Provider or alter Markcut/Neo Mobile for the alias. It invokes Neo.app Core's loopback-only REST endpoint
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
