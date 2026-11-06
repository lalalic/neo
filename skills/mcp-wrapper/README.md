# Neo MCP wrapper

One `wrapper.mjs` (here `markcut.mjs`) and its Neo.app Federation configuration
wrap an external MCP provider. No Neo.app Swift code is involved.

Use `markcut.mjs --federation /absolute/path/to/markcut/scripts/launch-mcp.sh`
to generate a JSON configuration. Set the existing Federation `markcut`
provider URL to the resulting URL. Standard MCP Tool and Resource calls pass
through unchanged, including MCP Apps UI metadata.

Managed previews bind a Relay Invocation and notify via Neo-owned APNs, using
`agents-relay review interactive` **CLI** and `neox/mac/NeoY/Runtime/src/core/tools/review.mjs` (Core service)
respectively. Markcut itself is an independent compiler and video player.

Do not configure both wrapped and unwrapped instances of the same Markcut Tool.

The Core review CLI is resolved from the selected, active Neo.app Core runtime
at `~/Library/Application Support/NeoY/runtimes/core/current/src/core/tools/review.mjs`.
For isolated tests, set `NEO_CORE_REVIEW_MODULE` to an absolute temporary Core
module path. The wrapper intentionally fails closed if a running Core version
lacks the Review Service; it never falls back to a developer checkout.
