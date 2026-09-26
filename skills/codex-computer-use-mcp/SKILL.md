---
name: codex-computer-use-mcp
description: Expose the macOS Computer Use tool surface through a trusted persistent Codex app-server thread and cua_repl.
---

# Codex Computer Use MCP

This stdio MCP server mirrors the Computer Use tools while keeping Computer Use inside Codex's trusted runtime.

Architecture:

    MCP client / MacBridge
            |
            v
    codex-computer-use-mcp
            |
            v
    persistent Codex app-server thread
      GPT-5.6 Luna / low reasoning / priority tier
            |
            v
    app-server mcpServer/tool/call
            |
            v
    cua_repl js -> @oai/sky -> SkyComputerUseService -> macOS UI

Normal proxy calls do not run a model turn. The persistent Codex thread supplies the trusted Computer Use context; the server deterministically maps each MCP tool to the same @oai/sky operation.

Run:

    node server.mjs

Environment overrides:
- CODEX_COMPUTER_USE_MCP_CODEX
- CODEX_HOME
- CODEX_COMPUTER_USE_MCP_CWD
- CODEX_COMPUTER_USE_MCP_MODEL
- CODEX_COMPUTER_USE_MCP_EFFORT
- CODEX_COMPUTER_USE_MCP_SERVICE_TIER
- CODEX_COMPUTER_USE_MCP_TIMEOUT_MS

Exported tools:
- list_apps
- get_app_state
- click
- perform_secondary_action
- set_value
- select_text
- scroll
- drag
- press_key
- type_text

Calls are serialized because they share one persistent trusted Computer Use session.
