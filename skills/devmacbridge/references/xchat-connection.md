# XChat connections: ChatGPT, Grok, and Claude

Resolve the skill directory as `<skill-folder>`.

Run:

```bash
<skill-folder>/scripts/setup-local.sh info
```

The local deployment is expected to expose the named public endpoint printed as `server_url` and one stable OAuth client id. The same OAuth client can be used by ChatGPT, Grok, and Claude because DevMacBridge validates each callback independently and issues separate OAuth grants/tokens.

## ChatGPT

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

ChatGPT's built-in callback forms are supported by the upstream bridge.

## Grok

Create a custom MCP connector with:

| Grok field | Value |
|---|---|
| Server URL | printed `server_url` |
| Authentication | OAuth |
| OAuth Client ID | printed `oauth_client_id` |
| OAuth Client Secret | blank |

This deployment explicitly allows Grok's callback:

```text
https://grok.com/connectors-oauth-exchange-code/
```

## Claude

Create a custom MCP connector with the same printed `server_url` and `oauth_client_id`. Leave the OAuth Client Secret blank. This deployment explicitly allows Claude's callback:

```text
https://claude.ai/api/mcp/auth_callback
```

## Consent token

When a client opens the local DevMacBridge consent page and requests the bridge token, run:

```bash
<skill-folder>/scripts/setup-local.sh copy-token
```

Paste from the clipboard. Never print the token. The skill deployment owns its protected token file in `.state/http-token`; setup generates it securely if it is missing.

## Verification

The named tunnel is stable; restarting `devmacbridge-tunnel` does not change the public hostname. Setup is complete only after the target client successfully calls `bridge_status` and one additional read-only MacDevBridge tool.
