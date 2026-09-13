# ChatGPT connection contract

Always confirm the fields against the current Mac Developer Bridge checkout before use.

## Server URL + OAuth

Use this when ChatGPT does not provide an enabled Secure MCP Tunnel connection type.

| ChatGPT field | Value |
|---|---|
| Connection | `Server URL` |
| Server URL | `https://<stable-hostname>/mcp` |
| Authentication | `OAuth` |
| Registration method | `User-Defined OAuth Client` |
| OAuth Client ID | value from MacDevBridge's `oauth-client-id` / menu-bar **Copy OAuth Client ID** |
| OAuth Client Secret | blank |
| Token endpoint auth method | `none` |
| Default scopes | `mcp` |
| OIDC enabled | off / unticked |

The bearer token is the consent credential, not a ChatGPT connector field. Copy it without printing it:

```bash
~/Workspace/neo/skills/devmacbridge/scripts/setup-local.sh copy-token
```

Before approving consent, read the displayed redirect target and verify that it is the ChatGPT connector currently being created.

## Endpoint durability

A quick Cloudflare tunnel produces a rotating `*.trycloudflare.com` hostname. That hostname is part of the OAuth issuer. Restarting the tunnel changes the issuer and can invalidate the saved connector.

A durable setup therefore needs either:

- OpenAI Secure MCP Tunnel, when the account/workspace actually supports it; or
- a named Cloudflare tunnel and stable hostname.

A verified quick-tunnel connection is useful for bootstrap and diagnostics but should be reported as `connected_ephemeral`.

## Final Web ChatGPT proof

Do not finish on "connector saved". In a Web ChatGPT conversation that has the Mac Developer Bridge app available, observe tool calls for:

- `bridge_status`
- one read-only file operation
- `events__health`
- `events__publish` and `events__wait`/`events__history`
