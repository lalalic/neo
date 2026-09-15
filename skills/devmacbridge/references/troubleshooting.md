# Troubleshooting

## Fresh setup has no public URL

Choose a hostname in a Cloudflare-managed DNS zone and configure it first:

```bash
<skill-folder>/scripts/setup-local.sh configure bridge.example.com
```

Then rerun `setup`.

## Cloudflare authentication is missing

Run once interactively:

```bash
cloudflared tunnel login
```

Then rerun `setup`. The skill creates the configured named tunnel if needed and routes the configured hostname to it.

## Local HTTP service is down

```bash
<skill-folder>/scripts/setup-local.sh restart
pm2 logs devmacbridge-http --lines 80 --nostream
```

## Named tunnel is down

```bash
<skill-folder>/scripts/setup-local.sh restart-tunnel
pm2 logs devmacbridge-tunnel --lines 80 --nostream
```

A named tunnel keeps the configured public hostname stable across restarts.

## OAuth Client ID is missing

Start or restart the HTTP service. It creates `<skill-folder>/.state/oauth-state.json` and persists the client ID there.

## `Unrecognised redirect_uri`

Read the HTTP log to obtain the exact rejected callback URI. Add only that trusted exact URI to `MAC_DEV_BRIDGE_OAUTH_REDIRECT_URIS` in `.state/config.env`, then run `restart`. Do not use broad domain or wildcard redirects.

Built-in/tested callbacks currently cover ChatGPT plus:

```text
https://grok.com/connectors-oauth-exchange-code/
https://claude.ai/api/mcp/auth_callback
```

## Consent token is needed

Never print the token. Copy it to the clipboard with:

```bash
<skill-folder>/scripts/setup-local.sh copy-token
```

## Token file permissions are rejected

```bash
chmod 600 <skill-folder>/.state/http-token
```

## events-bus tools are missing

On first setup, federation is generated automatically only when a sibling events-bus skill exists at:

```text
<skill-folder>/../events-bus/mcp/server.mjs
```

and `.state/mcp-servers.json` does not already exist.

If events-bus lives elsewhere, set `DEV_MAC_BRIDGE_EVENTS_BUS_DIR` before initial setup, or configure `.state/mcp-servers.json` explicitly. Existing federation configuration is preserved.

## Health works but MCP tool calls fail

Check:

1. OAuth completed successfully.
2. Server URL ends in `/mcp`.
3. `bridge_status` reports `fullAccessUnlocked: true`.
4. macOS TCC/permissions allow the requested operation.
5. `<skill-folder>/.state/logs/audit.jsonl` for the failing call.
6. `pm2 logs devmacbridge-http --lines 80 --nostream`.

## Services do not return after reboot

`pm2 save` stores the process list but does not install launchd startup by itself. Run:

```bash
pm2 startup
```

Follow the command PM2 prints, then run:

```bash
pm2 save
```
