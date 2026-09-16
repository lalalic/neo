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

## Upstream capability extensions

This deployment currently relies on two generalized DevMacBridge capability extensions that are being proposed upstream. Treat them as DevMacBridge features, not as application-specific patches.

### Federated MCP resources and UI metadata

Upstream PR #17, **feat: federate MCP resources and UI metadata**, extends child MCP federation beyond tools:

- proxy child `resources/list` and `resources/read`
- namespace resource URIs per provider
- rewrite `_meta.ui.resourceUri` and `openai/outputTemplate` through the parent bridge
- use the bridge data-directory `mcp-servers.json` as the default child-provider registry when no explicit registry is configured

Use this capability for any federated MCP provider that exposes MCP App/UI resources. Prefer the upstream implementation once merged or when equivalent support is present. Do not maintain a ZIP or copied patch artifact for this feature inside the skill.

### ChatGPT conversation attachments

Upstream PR #18, **feat: support attachments in ChatGPT browser conversations**, extends `chatgpt_conversation_start` with application-agnostic file transport:

- accept bounded HTTPS-backed attachments and mount them through ChatGPT's native composer
- return persisted assistant-generated files/images as structured `assistant_outputs`
- keep browser credentials and ChatGPT proof/session material inside the signed-in browser runtime

Consumers should use this generic attachment contract rather than adding file-type handling to each downstream application.

## Chrome native messaging note

For Chrome extension/native-host installation and debugging, especially with non-default state directories, read `references/chrome-native-messaging.md`. Chrome-launched native hosts do not reliably inherit the interactive shell environment, so installer-generated wrappers must carry resolved runtime configuration explicitly.
