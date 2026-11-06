---
name: mcp-wrapper
description: Integrate independent MCP providers into Neo with a one-file Node.js wrapper plus existing Neo.app Federation configuration.
---

# MCP wrapper

## Goal

Expose any independent MCP provider to Agents through Neo.app's unchanged
Federation boundary. A wrapped tool can perform Neo-owned orchestration while
preserving the original provider's Tool schema, UI metadata and Resources.
The Agent invokes the Tool **once**. Do not create a middleware framework or
put integration-specific orchestration inside Markcut, Swift, or Neo Mobile.

## Markcut example

The single `markcut.mjs` wrapper sends one `markcut.preview` invocation to the
original Markcut Server. For managed Relay Tasks it calls
`agents-relay review interactive ...` through **CLI**, not direct HTTP, to bind
an Invocation, put the Task in `AWAITING_DECISION`, bind immutable revision,
and recover from a failed render or notification. For standalone preview,
Relay is not called. It imports the Neo-owned private APNs module from
`../mobile-notification/apns.mjs` and persists a notification intent until
confirmed by the Neo Master durable Inbox. There is **no public
`neo.phone.notify` or `review.push.notify` Tool**.

Generate a machine-specific stdio Federation entry with:

```bash
node skills/mcp-wrapper/markcut.mjs --federation "$HOME/Workspace/markcut/scripts/launch-mcp.sh"
```

Install that URL under the existing Federation provider name `markcut`, not
in parallel with the original provider. `stdio-proxy.mjs` is a small reusable
transport helper; each new wrapped provider owns its own `*.mjs` file and
config. Keep MCP Apps UI descriptions, resource URIs and error statuses intact.

Run `node --test skills/mcp-wrapper/test/*.test.mjs` from the `neo` repo.
