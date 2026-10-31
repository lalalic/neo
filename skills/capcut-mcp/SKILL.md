---
name: capcut-mcp
description: Expose the account-authorized CapCut Creation MCP through Neo MCP federation, for AI video/image generation, captions, draft work and media search.
---

# CapCut MCP bridge

CapCut's official remote MCP is `https://www.capcut.com/api/external_mcp`; OAuth scope is `capcut:mcp`. The browser-approved OAuth profile is kept in a **private**, independent Codex data directory, not in the public Neo source repository. CapCut Desktop and the CapCut Codex plugin are not required.

The local stdio bridge at `server.mjs` uses `codex app-server` to reuse OAuth without reading or copying tokens. It discovers CapCut's native operations on demand and exposes them to Neo internally; **Neo's existing federation consolidates them into one public MCP tool `mcp.capcut`**. Neo federation supervises its lifecycle.

## One-time account connection

On the same Neo Master that hosts Neo MCP, authorize a dedicated Codex profile under `~/.local/share/neo/capcut-mcp-client`. Keep the approved profile private. Use Codex's official `mcp login` OAuth flow; do not copy cookies, tokens, or credentials into project files. Refresh login when CapCut reports an authentication failure.

## Add to Neo MCP

From an authorized Neo MCP client:

```
neo setup mcp add capcut 'stdio:///opt/homebrew/bin/node?arg=/Users/chengli/Workspace/neo/skills/capcut-mcp/server.mjs'
neo setup mcp list
```

The command above uses the current Neo Master path; adapt the absolute Node/script paths if deploying elsewhere. **After registering the MCP, enable the `capcut` provider under Neo Setup → MCP/Deployment → Remote Exposure.** Federation enablement alone does not expose tools to authenticated external clients. Confirm the actual public `tools/list` includes `mcp.capcut`.

Neo presents **one** public tool: `mcp.capcut`. Its `command` parameter selects any of the native CapCut operations. Bridge strips MCP Apps-only UI descriptors so Neo does not expose extra top-level tools. The bridge honors `CAPCUT_CODEX_HOME` and `CAPCUT_CODEX_BIN` for alternate deployments. Its default paths are `~/.local/share/neo/capcut-mcp-client` and `~/.local/bin/codex`.

## Safety and test

- In the bridge, `capcut({command:"help"})` lists all CapCut subcommands and approval requirements.
- Through the public Neo façade, call `mcp.capcut({command:"capcut",args:{command:"help"}})`, then use `mcp.capcut({command:"capcut",args:{command:"search_capcut_material",args:{type:"font",prompt:"font",top_n:1}}})`. Neo's outer command layer is expected.
- `capcut({command:"help",args:{command:"search_capcut_material"}})` shows the exact input schema.
- `capcut({command:"search_capcut_material",args:{type:"font",prompt:"font",top_n:1}})` runs a real read-only query.
- Calls with `readOnlyHint: true` and a small vetted set of query/poll tools remain read-only; verified example: `search_capcut_material`.
- Mutating subcommands demand `confirm_capcut_change: true` inside `mcp.capcut.args`; the bridge strips it before forwarding to CapCut. A caller must only set it after the user explicitly approves the specific action. Generation that might consume credits needs explicit cost approval first; use the available estimate tools when possible.
- Never autonomously start paid generation or modify existing drafts merely as a connectivity test.
- Check `mcp capcut` inventory, fetch the tool list, and run a read-only material search to establish end-to-end availability.

## Deployment boundary

ChatGPT receives the tools through Neo's existing federation. The bridge does not create a new public HTTP listener, persist CapCut results, or require Neo.app to restart. Never publish the private Codex profile or its OAuth state.
