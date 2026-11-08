# Quickstart: Chat Gateway

## Verify (no production side effects)

```bash
cd skills/chat-gateway
npm test                                  # isolated tests with injected NATS, dashboard, notifier, clock
node cli/chat-gateway.mjs serve --dry-run # logs notifications instead of sending them
```

## Install the service

```bash
chat-gateway setup                  # dry-run: shows the serviceman define and MCP registration
chat-gateway setup --apply          # defines chat-gateway/server and registers the MCP
neo service status chat-gateway/server
chat-gateway health                 # NATS, dashboard, notify path, last reconcile, pending entries
```

## Use

- Job completion: no action; terminal jobs notify the phone. The first start baselines existing jobs silently.
- Orchestrator thread: calls `mcp.chat-gateway.chat_report` when it decides the owner should know, and `mcp.chat-gateway.chat_env` to learn the owner's environment.
- Environment override: `chat-gateway env set home|office|auto`; `chat-gateway env get`.

## Project instruction text for the orchestrator

Report only when something deserves the owner's attention: a result, a blocker, a milestone. Use `attention` when the owner must see it now. Stay silent otherwise. Before asking for help, call `chat_env` and phrase the request for the owner's current environment.
