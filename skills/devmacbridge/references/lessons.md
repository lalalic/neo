# Lessons from real Mac Developer Bridge setup

These are operational lessons already observed on the user's environment and/or encoded in the current Mac Developer Bridge implementation. Re-check the current checkout before assuming a detail is permanent.

## 1. A green HTTP health endpoint does not prove MCP works

`/healthz` can answer before `bridge.mjs` is spawned. Always finish with a real MCP tool call from Web ChatGPT.

## 2. Personal ChatGPT may show Tunnel but not allow selecting it

Do not burn time trying to force OpenAI Secure MCP Tunnel when the account UI disables it. Use `Server URL` + OAuth through the HTTP front end instead.

## 3. ChatGPT does not provide a bearer-token connector field

For the HTTP transport, the connector uses OAuth. The bridge's static bearer token is entered on the bridge-hosted consent page, not in the ChatGPT plugin form.

## 4. OIDC must be off for the current HTTP connector

The bridge serves OAuth metadata and does not issue an ID token. Leaving OIDC enabled can make a strict client fail authentication.

## 5. Quick Cloudflare tunnels are not durable connectors

Their hostname changes on restart. Because the hostname is the OAuth issuer, the saved connector can silently fail after rotation. Prefer a named tunnel and stable hostname.

## 6. Keep the token out of process listings and agent text

The menu-bar app stores the HTTP token in a mode-0600 file and passes its path. Prefer that to environment tokens. For consent automation, copy the file directly to clipboard without printing it.

## 7. Prefer the menu-bar app for personal/HTTP transport lifecycle

It supervises both `mcp-http.mjs` and `cloudflared`, manages the revocable unlock file, reclaims known orphans, uses a login-shell PATH, and stops sibling processes together when one dies.

## 8. The unlock file is a real fail-closed control

`FULL_ACCESS_ENABLED` is re-read before tool calls. A standing `MAC_DEV_BRIDGE_FULL_ACCESS_ACK` environment variable is not revocable in the same way; the menu-bar app intentionally strips it from children.

## 9. Stop cloudflared before using the broad kill-switch diagnostic

The repository's `disable.sh` reports an independently running cloudflared as not-contained. For HTTP transport cleanup, stop the tunnel first, then run `disable.sh` and read its containment result.

## 10. Rebuilding an ad-hoc-signed menu app can invalidate Full Disk Access

When no stable code-signing identity is available, the app may be ad-hoc signed and its identity can change after rebuild. If protected paths start returning `EPERM`, remove/re-add the app in macOS Full Disk Access and restart it. A stable signing identity avoids this churn.

## 11. Do not use MacDevBridge's own browser channel to bootstrap itself

The background Chrome integration needs a native host plus a loaded unpacked extension. Before that extension is online, use an already-available computer-use/Codex browser or foreground user interaction for the Chrome extension page and ChatGPT settings.

## 12. Chrome extension installation has two separate halves

`scripts/install-background-chrome.sh` installs/binds the native host. Chrome still needs the unpacked `chrome-extension/` loaded once. Verify the expected extension id from the current project rather than assuming the native-host script alone completed setup.

## 13. Preserve dirty source checkouts

This user's Mac Developer Bridge checkout has been used for active development. A setup tool must never run `reset --hard`, `clean`, auto-stash, or overwrite a dirty tree merely to get the newest upstream version.

## 14. Events-bus belongs behind MCP federation

The working architecture is:

```text
Web ChatGPT
  -> Mac Developer Bridge MCP
      -> events__* federated tools
          -> events-bus/mcp/server.mjs
              -> loopback NATS
```

Do not expose NATS publicly. The working registry is `$DATA_DIR/mcp-servers.json`, with an `events` provider pointing at the Neo `events-bus` MCP server.

## 15. Restart the bridge after changing federation registry

A correct `mcp-servers.json` is not enough if the currently running bridge was started before the change. Restart, then inspect `bridge_status.federation` and finally verify `events__*` from Web ChatGPT.

## 16. Sandboxed Codex workers should publish events through MCP

Direct TCP access to loopback NATS can be denied by the Codex sandbox. Use MacDevBridge `events__publish` and pre-approve only that specific tool for unattended progress emission rather than disabling approvals globally.

## 17. Verification must cross the same boundary the user cares about

Local shell success, a running app, a saved plugin, and a listed tool are intermediate evidence. The end state is proven only when the actual Web ChatGPT connector calls a tool and receives the expected Mac result.

## 18. DevMacBridge blocks direct Chrome GUI bypasses from its own shell

Direct Chrome automation through bridge shell commands is intentionally routed away from foreground/browser bypasses. Keep bootstrap browser work in computer-use/Codex browser, and keep the deterministic local helper free of Chrome GUI commands.

## 18. MDB shell routing can reject bootstrap commands before the shell runs

MacDevBridge structurally refuses shell commands that look like direct Chrome GUI/browser launching, even in Relaxed mode. During self-bootstrap, keep Chrome UI work in computer-use/Codex browser and keep deterministic shell helpers browser-GUI-free. Do not interpret a `CHROME_BACKGROUND_REQUIRED` rejection as a shell or file-writing failure.
