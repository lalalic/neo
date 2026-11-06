# Neo MCP wrapper

One provider-specific `markcut.mjs` and its Neo.app Federation configuration
wrap the external Markcut MCP provider. The wrapper itself remains independent
of Neo.app Swift code, but its notification target is Neo.app Core REST.

Use `markcut.mjs --federation /absolute/path/to/markcut/scripts/launch-mcp.sh`
to generate a JSON configuration. Set the existing Federation `markcut`
provider URL to the resulting URL. Standard MCP Tool and Resource calls pass
through unchanged, including MCP Apps UI metadata.

Managed previews bind a Relay Invocation via `agents-relay review interactive`
**CLI**, then notify through Neo.app Core REST `POST /mobile/review/notify`. Markcut itself is an independent compiler and video player.

Do not configure both wrapped and unwrapped instances of the same Markcut Tool.

The wrapper discovers the listener port from Neo.app's deployed
`~/Library/Application Support/NeoY/deployment.json`, then submits the review
through the local-only `POST /mobile/review/notify` REST endpoint. Override via
`NEO_REVIEW_NOTIFY_URL` only for a loopback endpoint. The wrapper fails closed if
Neo.app Core does not support that route; it never falls back to a local CLI.
