# ChatGPT browser bridge: server/MCP contract

This optional mode keeps Discord transport and privacy enforcement inside the Family Tutor orchestrator while a separate Chrome extension owns ChatGPT tab binding and composer mechanics.

Enable it only in the private `runs/family/config/family.config.json`:

```json
"browserBridge": { "enabled": true, "host": "127.0.0.1", "port": 43117 }
```

At startup the orchestrator creates `runs/family/.chatgpt-browser-bridge/token` with mode `0600`. The extension copies that private token into its own local configuration and sends it as `Authorization: Bearer <token>` for bridge endpoints. Nothing under `runs/` is committed.

The extension polls `GET /v1/turns/next?childId=<id>`. A child has at most one in-flight turn; another turn for that child is not released until the active correlation is replied to or failed. Different children remain independent. A turn contains only the current message, correlation metadata, and transient localhost attachment URLs. Image files are downloaded below `runs/family/.chatgpt-browser-bridge/blobs/`, are never committed, and are deleted when the correlation completes or expires.

For a failed browser submission, call `POST /v1/turns/<correlationId>/failed` with the bearer token so that child's next queued turn can proceed.

The same loopback server exposes MCP JSON-RPC at `POST /mcp`. It implements `initialize`, `tools/list`, and `tools/call`, with one tool:

- `reply_to_discord({ correlation_id, text })` replies to the exact original Discord message in its original channel/thread. Correlation IDs are random, short-lived capabilities; unknown, expired, or already-completed IDs are rejected.

The MCP endpoint never accepts a Discord channel/message id directly, so a ChatGPT session cannot redirect a reply into another child or parent channel. The browser extension remains responsible only for tab binding, attachment upload, composer fill/submit, and error acknowledgement.

For local MCP clients, run `src/browser-mcp-stdio.mjs`; it uses `FAMILY_TUTOR_BRIDGE_TOKEN`, or reads the generated token when `FAMILY_TUTOR_CONFIG` is set.
