---
name: capcut-mcp
description: Expose the account-authorized CapCut Creation MCP through Neo MCP federation, for AI video/image generation, captions, draft work and media search.
---

# CapCut MCP bridge

CapCut's official remote MCP is `https://www.capcut.com/api/external_mcp`; OAuth scope is `capcut:mcp`. The browser-approved OAuth profile is kept in a **private**, independent Codex data directory, not in the public Neo source repository. CapCut Desktop and the CapCut Codex plugin are not required.

The local stdio bridge at `server.mjs` uses `codex app-server` to reuse OAuth without reading or copying tokens. It discovers the official tools on demand and forwards tool calls. Neo federation supervises its lifecycle.

## One-time account connection

On the same Neo Master that hosts Neo MCP, authorize a dedicated Codex profile under `~/.local/share/neo/capcut-mcp-client`. Keep the approved profile private. Use Codex's official `mcp login` OAuth flow; do not copy cookies, tokens, or credentials into project files. Refresh login when CapCut reports an authentication failure.

## Add to Neo MCP

From an authorized Neo MCP client:

```
neo setup mcp add capcut 'stdio:///opt/homebrew/bin/node?arg=/Users/chengli/Workspace/neo/skills/capcut-mcp/server.mjs'
neo setup mcp list
```

The command above uses the current Neo Master path; adapt the absolute Node/script paths if deploying elsewhere. A tool should be exposed as `mcp.capcut.<CapCut tool name>` after federation refresh. The bridge honors `CAPCUT_CODEX_HOME` and `CAPCUT_CODEX_BIN` for alternate deployments. Its default paths are `~/.local/share/neo/capcut-mcp-client` and `~/.local/bin/codex`.

## Safety and test

- Calls with `readOnlyHint: true` remain read-only; verified example: `search_capcut_material`.
- Mutating tools demand `confirm_capcut_change: true`, which the bridge strips before forwarding. A caller must only set it after the user explicitly approves the specific action. Generation that might consume credits needs explicit cost approval first; use the available estimate tools when possible.
- Never autonomously start paid generation or modify existing drafts merely as a connectivity test.
- Check `mcp capcut` inventory, fetch the tool list, and run a read-only material search to establish end-to-end availability.

## Deployment boundary

ChatGPT receives the tools through Neo's existing federation. The bridge does not create a new public HTTP listener, persist CapCut results, or require Neo.app to restart. Never publish the private Codex profile or its OAuth state.
