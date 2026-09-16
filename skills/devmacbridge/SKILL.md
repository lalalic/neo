---
name: devmacbridge
description: Set up, run, stop, repair, and verify DevMacBridge so XChat clients such as ChatGPT, Grok, and Claude can connect to and operate the user's Mac through an MCP Server URL.
---

# DevMacBridge

Use this skill when the user wants to set up DevMacBridge, connect or reconnect an XChat client such as ChatGPT, Grok, or Claude to the Mac, inspect its connection details, or manage its two PM2 services.

## Goal

Complete only when the target XChat client can make a real DevMacBridge tool call. A healthy local process alone is not completion.

## Layout

Resolve the skill directory from the loaded `SKILL.md`; call it `<skill-folder>`. Never assume a particular workspace path.

The skill owns this layout:

```text
<skill-folder>/
├── devmacbridge/           # upstream checkout
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

`setup` clones or safely updates the upstream checkout, creates protected runtime state, and starts two independent PM2 services for the skill-owned deployment:

- `devmacbridge-http` — Node.js MCP HTTP entrypoint (local deployment default: port 8788).
- `devmacbridge-tunnel` — named Cloudflare Tunnel forwarding `bridge.qili2.com` to the local HTTP entrypoint.

A normal code change requires only `restart`. The named tunnel has a stable hostname, so `restart-tunnel` does not require changing client configuration.

## Connection information

Read the exact fields from these sources:

- Server URL: the configured `MAC_DEV_BRIDGE_PUBLIC_URL` (local default `https://bridge.qili2.com`), plus `/mcp`.
- OAuth Client ID: `client.id` in `<skill-folder>/.state/oauth-state.json`; the same client id can be configured in ChatGPT, Grok, and Claude.
- Consent token: `<skill-folder>/.state/http-token`; is owned by this skill deployment and generated securely when missing. Use `copy-token` and never print it.

The `info` command prints the Server URL and OAuth Client ID but never the token.

Configure ChatGPT, Grok, or Claude using [references/xchat-connection.md](references/xchat-connection.md). The deployment supports the required OAuth callbacks for each configured XChat client through `MAC_DEV_BRIDGE_OAUTH_REDIRECT_URIS`.

## Repository safety

If the nested checkout is clean, a fast-forward-only update is allowed. If it is dirty, preserve it and do not pull, stash, reset, clean, or overwrite it.

## Verification

After setup:

1. Confirm both PM2 services are online.
2. Confirm `http://127.0.0.1:8788/healthz` succeeds.
3. Confirm the named public URL `/healthz` succeeds.
4. Confirm `info` returns a concrete Server URL and OAuth Client ID.
5. Configure or update the target ChatGPT, Grok, or Claude connector.
6. From that client, call `bridge_status`, then one read-only tool such as `fs_stat`.

If the final remote call is not observed, report the setup as incomplete and identify the failing layer.

## Rich event progress UI

Neo `events-bus` exposes `events__progress` with an MCP App resource (`text/html;profile=mcp-app`) for a richer live progress card. DevMacBridge must federate MCP resources as well as tools for that UI to reach XChat clients: child `resources/list` and `resources/read` must be proxied, and tool UI resource URIs must be rewritten through the parent bridge.

The upstream implementation is proposed in `alexanderradahl/mac-developer-bridge` PR #17, **Proxy federated MCP resources for app UIs**, targeted at upstream base `fea70d1`. Prefer the upstream implementation whenever it is merged or equivalent resource-federation support is present.

As a fallback, this skill retains the exact tested upstream patch in:

```text
<skill-folder>/patches/events-bus-ui/devmacbridge-federated-ui-fea70d1.zip
```

The archive contains a `git format-patch` plus a manifest recording the upstream base/head and validation. Before applying it, first inspect the current upstream checkout for equivalent `resources/list` / `resources/read` federation. Do not apply the fallback on top of an upstream implementation that already provides those capabilities. If the fallback is still needed, unpack it outside the repository and apply the contained patch with `git am --3way`; resolve or stop on conflicts rather than forcing it.

After enabling resource federation, verify both layers: `events__progress` must still return normal structured/text progress data, and an MCP Apps-capable XChat client should be able to load the associated UI resource. The rich card is supplemental; user-visible event messages remain mandatory.

## Chrome native messaging note

For Chrome extension/native-host installation and debugging, especially with non-default state directories, read `references/chrome-native-messaging.md`. Chrome-launched native hosts do not reliably inherit the interactive shell environment, so installer-generated wrappers must carry resolved runtime configuration explicitly.
