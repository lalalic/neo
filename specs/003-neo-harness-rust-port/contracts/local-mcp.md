# Native NeoY MCP and Computer Use CLI bridge

Owned by Neo Harness `neo-rs` **only as a restricted client**. Signed macOS
permissions, service lifecycle, Accessibility and all actual tool effects
remain wholly owned by the existing NeoY native MCP gateway.

## Network and capability boundary

- MCP endpoint is always local `http://127.0.0.1:<port>/mcp`, derived from
  `~/Library/Application Support/NeoY/deployment.json` with default port 6767
  (legacy 9224 maps to 6767). Invalid deployment config fails closed.
- No discovery of remote hosts or provision of additional authority.
  JSON-RPC is POST-only; redirects rejected and HTTP and JSON-RPC errors
  cannot be confused with successful tools.
- `neo-rs mcp tools` filters the live `tools/list` response to only
  `markcut.preview`, `review.preview`, and `askquestions` including metadata.
- `neo-rs mcp call NAME --args-file PATH` accepts only one of those names,
  validates the tool-specific allowed arguments, checks that the live provider
  registered it, and forwards JSON-RPC `tools/call`. Tool `isError:true`
  produces exit status 2.
- `neo-rs computer-use help` and `neo-rs computer-use call COMMAND
  [--args-file PATH]` use **only** the existing `computer` MCP facade.
  Their whitelist is `list_apps,get_app_state,click,drag,key,scroll,type,
  select_text,set_value,perform_secondary_action`. Unauthorized commands
  are rejected before any network request. Help filters returned commands.
- No arbitrary local shell/system setup/gateway administrative MCP tools
  exposed by the CLI. No ambient bearer token inserted in these calls.

## Evidence (2026-11-23)

- Native disposable loopback Gateway tests: **7/7 pass**, covering permitted
  tools, rejected privilege escalation, malformed file/port, HTTP errors,
  invalid JSON-RPC IDs, denied tool results, and redirect rejection.
- Original reference tests: `node --test test/neo-mcp-local.test.mjs`
  **12/12 pass**.
- Rust `cargo test --workspace --offline`: **64/64 integration tests**;
  `cargo clippy --workspace --all-targets --offline -- -D warnings` passes.
- Read-only **live NeoY** smoke test: `neo mcp tools` and `neo-rs mcp tools`
  both succeed and yield identical JSON with the same three tools and schemas.
  `computer-use help` yields the same ten commands. Raw nested JSON text
  key order is not byte-stable even between two Node calls; decoded JSON
  meaning is stable and matches Rust, so no fake order-normalization shim.
- Never used live `computer-use click`, token issuance or any mutating MCP
  tool during acceptance. T017 remains open until OAuth token/escalation and
  remaining CLI ownership work are separately ported and verified.
