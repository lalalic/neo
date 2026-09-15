---
name: devmacbridge
description: Set up, run, stop, repair, and verify Mac Developer Bridge so ChatGPT can connect to and operate the user's home Mac through an MCP Server URL.
---

# DevMacBridge

Use this skill when the user wants to set up MacDevBridge, reconnect ChatGPT to the Mac, inspect its connection details, or manage its two PM2 services.

## Goal

Complete only when ChatGPT can make a real MacDevBridge tool call. A healthy local process alone is not completion.

## Layout

Resolve the skill directory from the loaded `SKILL.md`; call it `<skill-folder>`. Never assume a particular workspace path.

The skill owns this layout:

```text
<skill-folder>/
├── mac-developer-bridge/   # upstream checkout
├── .state/                 # MAC_DEV_BRIDGE_DATA_DIR
├── cloudflared.log         # deterministic Quick Tunnel log
├── scripts/setup-local.sh
└── SKILL.md
```

Do not modify upstream bridge code for this deployment. Keep the nested checkout, runtime state, and tunnel log out of the parent repository.

## Commands

Use the bundled script:

```bash
<skill-folder>/scripts/setup-local.sh setup
<skill-folder>/scripts/setup-local.sh status
<skill-folder>/scripts/setup-local.sh info
<skill-folder>/scripts/setup-local.sh copy-token
<skill-folder>/scripts/setup-local.sh restart
<skill-folder>/scripts/setup-local.sh restart-tunnel
<skill-folder>/scripts/setup-local.sh stop
```

`setup` clones or safely updates the upstream checkout, creates protected runtime state, and starts two independent PM2 services:

- `macdevbridge-http` — Node.js MCP HTTP entrypoint.
- `macdevbridge-tunnel` — Cloudflare Quick Tunnel forwarding to loopback port 8787.

A normal code change requires only `restart`. Do not restart the tunnel unless necessary because a new Quick Tunnel hostname requires updating the ChatGPT connector.

## Connection information

Read the exact fields from these sources:

- Server URL: latest `https://*.trycloudflare.com` value in `<skill-folder>/cloudflared.log`, plus `/mcp`.
- OAuth Client ID: `client.id` in `<skill-folder>/.state/oauth-state.json`.
- Consent token: `<skill-folder>/.state/http-token`; use `copy-token` and never print it.

The `info` command prints the Server URL and OAuth Client ID but never the token.

Configure ChatGPT using [references/chatgpt-connection.md](references/chatgpt-connection.md).

## Repository safety

If the nested checkout is clean, a fast-forward-only update is allowed. If it is dirty, preserve it and do not pull, stash, reset, clean, or overwrite it.

## Verification

After setup:

1. Confirm both PM2 services are online.
2. Confirm `http://127.0.0.1:8787/healthz` succeeds.
3. Confirm `info` returns a concrete Server URL and OAuth Client ID.
4. Configure or update the ChatGPT connector.
5. From ChatGPT, call `bridge_status`, then one read-only tool such as `fs_stat`.

If the final remote call is not observed, report the setup as incomplete and identify the failing layer.
