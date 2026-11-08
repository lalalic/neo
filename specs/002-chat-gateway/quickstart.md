# Quickstart: Chat Gateway

## Verify (no production side effects)

```bash
cd skills/chat-gateway
npm test                                  # isolated tests with injected NATS, dashboard, notifier, clock
node cli/chat-gateway.mjs serve --dry-run # logs notifications instead of sending them
```

## Final install only after Mobile E2E passes and code is merged

Run from the canonical checkout on Neo Master:

    cd /Users/chengli/Workspace/neo/skills/chat-gateway
    npm ci --ignore-scripts
    ./neo-project setup
    node cli/chat-gateway.mjs setup         # no-write plan
    node cli/chat-gateway.mjs setup --apply # direct-source PM2 and existing MCP federation
    ./neo-project health

Production runs tracked source, never an npm tarball, packaged runtime, or disposable hotfix worktree.

## Use

- Job completion: no action; terminal jobs notify the phone. The first start baselines existing jobs silently.
- Orchestrator thread: calls `mcp.chat-gateway` with `command: "chat_report"` when it decides the owner should know, and `mcp.chat-gateway` with `command: "chat_env"` to learn the owner's environment.
- Mobile Chat: chat_feed lists history, chat_head shows binding, chat_send submits owner messages, and chat_bind updates the head on orchestrator handoff. Queue acceptance is not a generated answer.
- Environment override: `chat-gateway env set home|office|auto --apply`; `chat-gateway env get`.

## Project instruction text for the orchestrator

Report only when something deserves the owner's attention: a result, a blocker, a milestone. Use `attention` when the owner must see it now. Stay silent otherwise. Before asking for help, call `chat_env` and phrase the request for the owner's current environment.
