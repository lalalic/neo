# ChatGPT connection

Resolve the skill directory as `<skill-folder>`.

Run:

```bash
<skill-folder>/scripts/setup-local.sh info
```

Configure the ChatGPT MCP connector with:

| ChatGPT field | Value |
|---|---|
| Connection | `Server URL` |
| Server URL | printed `server_url` |
| Authentication | `OAuth` |
| Registration method | `User-Defined OAuth Client` |
| OAuth Client ID | printed `oauth_client_id` |
| OAuth Client Secret | blank |
| Token endpoint auth method | `none` |
| Default scopes | `mcp` |
| OIDC enabled | off |

When the local consent page requests the bridge token, run:

```bash
<skill-folder>/scripts/setup-local.sh copy-token
```

Paste from the clipboard. Never print the token.

A Quick Tunnel hostname changes when `macdevbridge-tunnel` is recreated. After `restart-tunnel`, run `info` and update the connector's Server URL.

Setup is complete only after ChatGPT successfully calls `bridge_status` and one read-only MacDevBridge tool.
