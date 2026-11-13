# Neo MCP wrapper

One provider-specific `markcut.mjs` and its Neo.app Federation configuration
wrap the external Markcut MCP provider. The wrapper itself remains independent
of Neo.app Swift code, with a NeoY generic APNs transport, not a Node Core Review service.

Use `markcut.mjs --federation /absolute/path/to/markcut/scripts/launch-mcp.sh`
to generate a JSON configuration. Set the existing Federation `markcut`
provider URL to the resulting URL. Standard MCP Tool and Resource calls pass
through unchanged, including MCP Apps UI metadata.

## Agent-facing Preview tools

- `markcut.preview({path, title?, readonly?, review?})` accepts a general optional
  display title (also shown in Neo Mobile Review Inbox).
- `review.preview({path, title?, relay?})` forwards that title unchanged.
  Without `relay` it remains view-only; with a valid Relay execution it uses
  the existing interactive wait/decision path.
- `askquestions({title?, questions, relay?})` is a lightweight alias:
  `questions` is an array of 1-40 **Markdown** strings. The wrapper generates
  an isolated `.ghost.askquestions.md` with one Markcut Scene per question.
  The player renders Markdown and shows one answer box per Scene with a single
  **Submit** button. Submitted answers are Scene comments (including empty
  answers). On Relay Tasks, Submit uses the existing `approved` transport
  decision to **resume the waiting Task**, not to approve its work product.
  Standalone Submit posts the answer JSON into the caller conversation.
  No separate answer database or Event type is introduced.

Managed previews bind a Relay Invocation via `agents-relay review interactive`
**CLI**, persist requests in the wrapper delivery queue, then wake Neo Mobile
through NeoY's loopback-only generic `POST /mobile/notify`. Markcut remains an
independent compiler and video player.

Do not configure both wrapped and unwrapped instances of the same Markcut Tool.

The wrapper discovers the listener port from Neo.app's deployed
`~/Library/Application Support/NeoY/deployment.json`, then submits the review
through the local-only `POST /mobile/notify` REST endpoint. Override via
`NEO_REVIEW_NOTIFY_URL` only for a loopback endpoint. The full request is already
stored in the wrapper before any APNs attempt, and failed APNs delivery does
not lose the request. Neo.app publishes the wrapper's `review.preview` and app-only
`review.preview.acquire` under these exact names (no `markcut.` prefix).
`markcut.preview.media` is an app-only media lookup by compiled content hash;
it is consumed by the phone and does not initiate a review or compile.
`review.preview.acquire` serves pending requests through
the authenticated Neo MCP gateway; the phone ACKs after local persistence.
The standalone Markcut CLI delivers via the installed wrapper's `deliver`
command, not via a separate Review REST endpoint.
