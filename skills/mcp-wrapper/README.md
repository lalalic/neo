# Neo MCP wrapper

One provider-specific `markcut.mjs` and its Neo.app Federation configuration
wrap the external Markcut MCP provider. The wrapper itself remains independent
of Neo.app Swift code, with a NeoY generic APNs transport, not a Node Core Review service.

Use `markcut.mjs --federation /absolute/path/to/markcut/scripts/launch-mcp.sh`
to generate a JSON configuration. Set the existing Federation `markcut`
provider URL to the resulting URL. Standard MCP Tool and Resource calls pass
through unchanged, including MCP Apps UI metadata.

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
not lose the request. `review.preview.acquire` serves pending requests through
the authenticated Neo MCP gateway; the phone ACKs after local persistence.
The standalone Markcut CLI delivers via the installed wrapper's `deliver`
command, not via a separate Review REST endpoint.
