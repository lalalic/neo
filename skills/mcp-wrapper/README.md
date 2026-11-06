# Neo MCP wrapper

One `wrapper.mjs` (here `markcut.mjs`) and its Neo.app Federation configuration
wrap an external MCP provider. No Neo.app Swift code is involved.

Use `markcut.mjs --federation /absolute/path/to/markcut/scripts/launch-mcp.sh`
to generate a JSON configuration. Set the existing Federation `markcut`
provider URL to the resulting URL. Standard MCP Tool and Resource calls pass
through unchanged, including MCP Apps UI metadata.

Managed previews bind a Relay Invocation and notify via Neo-owned APNs, using
`agents-relay review interactive` **CLI** and `../mobile-notification/apns.mjs`
respectively. Markcut itself is an independent compiler and video player.

Do not configure both wrapped and unwrapped instances of the same Markcut Tool.
