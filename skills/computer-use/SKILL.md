---
name: computer-use
description: Operate native macOS applications on Neo Master with Neo.app's existing Computer Use implementation through the synchronous neo computer-use CLI. Use for UI inspection, screenshots, clicks, typing, and keyboard input outside WebHelm.
---

# Computer Use

Use the local `neo` CLI to inspect and operate macOS applications. The CLI calls the **already running** Neo.app over its loopback MCP endpoint. Do not start another GUI automation engine or require the agent to configure an MCP client.

## Workflow

1. Run `neo computer-use help` to discover current operations. `neo mcp tools` shows the live tool catalog.
2. Run `neo computer-use call list_apps` to identify the correct application.
3. Capture a fresh state before interaction: create a JSON arguments file with `{"app":"Finder"}`, then run `neo computer-use call get_app_state --args-file /path/to/args.json`.
4. Choose a target from the returned UI state. For operations requiring parameters, write an **object** to a private JSON file and call `neo computer-use call COMMAND --args-file /path/to/args.json`. Use `state_id` and `element_index` from the same snapshot for state-scoped actions. Re-capture when stale.
5. Observe the result and re-read the app state to verify the intended UI change. Do not equate a successful keypress with task completion.

## Contract

- The command finishes synchronously and prints the original MCP result JSON, including `content` and `isError`. Exit status is nonzero for transport failures and MCP `isError`.
- CLI-to-Neo.app communication is strictly local. Neo.app owns OS permissions, enabled-tool checks, and auditing.
- For browser automation in managed Chrome, prefer the separate `webhelm` Skill. For simple files and processes, use Shell directly.
- Avoid guessing controls or pasting secrets into logs. Do not perform external or irreversible actions outside the user's authorization.
- Other Neo.app MCP tools are available with `neo mcp call TOOL [--args-file PATH]`; do not copy their implementation into this Skill.
