---
name: devmacbridge
description: End-to-end setup, repair, and verification of Mac Developer Bridge. Use when the user says "setup mac bridge", "setup devmacbridge", or wants an agent to clone/update the bridge, build/install it, connect ChatGPT through MCP, configure the optional signed-in Chrome integration, federate Neo events-bus tools, and keep going until Web ChatGPT can actually call the tools.
---

# DevMacBridge

## What this skill enables

A user should be able to say **"setup mac bridge"** and have an agent take a Mac from an unconfigured state to a verified Web ChatGPT ↔ Mac Developer Bridge connection with Neo events-bus integration.

Real goal: **make the bridge operational end-to-end, not merely installed.**

Capability tree:

1. discover or obtain the Mac Developer Bridge checkout without destroying local work;
2. satisfy local prerequisites and build/install the supported Mac components;
3. choose and start the transport appropriate to the ChatGPT account/environment;
4. use computer-use or a capable Codex browser for one-time Chrome/ChatGPT UI configuration;
5. configure `events-bus` as a federated child MCP provider;
6. verify the local bridge, remote ChatGPT connector, and event tools with real calls;
7. diagnose known failure modes and self-repair safe configuration drift.

Read `references/lessons.md` before setup or repair. It records failure modes already encountered on this system.

## Trigger and authorization

The explicit request **"setup mac bridge"** (or equivalent) authorizes the normal setup actions required for this workflow: clone a missing checkout, fast-forward a clean checkout, install ordinary required packages, build/install the menu-bar app, install the background-Chrome native host, start/restart bridge services, configure MCP federation, and create/update the ChatGPT developer connector.

It does **not** authorize:

- discarding or resetting a dirty checkout;
- force-pushing or rewriting repository history;
- deleting unrelated ChatGPT plugins/connectors;
- exposing bearer tokens, API keys, OAuth secrets, cookies, or browser credentials in prompts/logs/events;
- guessing or storing a user's password, MFA code, passkey, or administrator credential.

When authentication or an OS security dialog genuinely requires the user, stop only at that boundary and state the exact action needed. Resume automatically afterward.

## Primary workflow

Use `agents/setup-agent.md` as the execution contract.

### 1. Inspect first, then bootstrap only missing layers

Start with the read-only status helper:

```bash
~/Workspace/neo/skills/devmacbridge/scripts/setup-local.sh status
```

Do not rebuild a working installation just because setup was requested. Rebuilding can change the app signature and disturb macOS privacy grants. If the checkout/app/native host/events layer is missing or broken, run the smallest applicable action (`repo`, `build`, or `events`). Use `all` only for a genuinely new/incomplete local installation.

```bash
~/Workspace/neo/skills/devmacbridge/scripts/setup-local.sh all
```

The helper:

- clones the canonical repository when missing;
- preserves an existing dirty checkout and never resets it;
- fast-forwards an existing clean checkout when possible;
- checks required local tooling;
- installs `cloudflared`/`nats-server` with Homebrew when they are missing and Homebrew is available;
- validates the bridge source;
- builds and installs `MacDevBridge.app`;
- installs the background-Chrome native messaging host;
- starts/repairs the local Neo `events-bus` NATS service through PM2;
- merges the `events` provider into MacDevBridge's `mcp-servers.json` without deleting other providers.

The helper deliberately does not automate passwords/MFA or brittle ChatGPT UI coordinates.

### 2. Choose transport from observable capability

Do not assume the account type from memory. Inspect the current ChatGPT developer-plugin UI.

Prefer:

1. **OpenAI Secure MCP Tunnel** when the `Tunnel` connection type is actually available and the supported `tunnel-client` resources are present.
2. Otherwise **Server URL + OAuth** through MacDevBridge's HTTP front end and Cloudflare Tunnel.

For the Server URL path, prefer a **named Cloudflare tunnel with a stable hostname**. A quick `trycloudflare.com` tunnel is acceptable only as an end-to-end bootstrap/smoke path and must be reported as `connected_ephemeral`, not durable setup completion.

### 3. Use UI automation for the one-time bootstrap steps

First-time setup has a circularity: MacDevBridge browser tools cannot install the Chrome extension or ChatGPT connector that make those browser tools available. Use the harness's existing **computer-use** or **Codex browser** for bootstrap UI.

Use semantic UI inspection rather than stored coordinates. Typical tasks:

- launch `MacDevBridge.app` and choose **Start**;
- open Chrome's Extensions page, enable Developer mode and **Load unpacked** from `<repo>/chrome-extension/`;
- enable ChatGPT Developer mode if needed;
- create or repair the Mac Developer Bridge developer plugin/app;
- select `Tunnel` or `Server URL` according to the chosen transport;
- for Server URL, configure OAuth as documented in `references/chatgpt-connection.md`;
- approve the local consent page only after confirming its redirect target belongs to the connector being created.

The helper command below copies the bearer token directly from its mode-0600 file to the clipboard without printing it:

```bash
~/Workspace/neo/skills/devmacbridge/scripts/setup-local.sh copy-token
```

Paste it into the consent page; never put the token in an agent message or event.

### 4. Restart after federation changes

MacDevBridge reads child MCP registry configuration at bridge startup. After `mcp-servers.json` changes, restart the bridge through the menu-bar app (Stop → Start) or the transport's supported lifecycle path before judging federation health.

### 5. Verify the actual outcome

Local installation is not completion. `healthz` is not completion. A saved ChatGPT plugin is not completion.

The setup is complete only after a Web ChatGPT conversation using the connector performs real read-only calls and observes valid results:

1. `bridge_status` returns the expected Mac identity and `fullAccessUnlocked: true`;
2. a read-only filesystem call such as `fs_stat` succeeds;
3. `events__health` succeeds through MacDevBridge federation;
4. an `events__publish` + `events__wait` smoke event round-trip succeeds with a fresh setup-smoke `job_id`.

When possible, have the Web ChatGPT test conversation perform these calls itself. Do not replace that evidence with a local curl or a successful setup script.

Completion states:

- `ready` — durable endpoint plus verified Web ChatGPT tool calls and events round-trip;
- `connected_ephemeral` — verified through a rotating/quick endpoint that will require connector repair after restart;
- `blocked` — user authentication/permission/security action is required;
- `failed` — setup or repair did not produce a verified tool call;
- `uncertain` — connector may exist but the Web ChatGPT call path could not be observed.

## Events-bus integration

MacDevBridge is the MCP federation gateway. Register the Neo events server as the `events` provider so remote clients receive tools such as:

```text
events__health
events__wait
events__history
events__status
events__publish
```

Do not expose NATS directly to Web ChatGPT. NATS stays loopback-local; `events-bus/mcp/server.mjs` is the federated boundary.

For sandboxed Codex workers, follow the `events-bus` contract: publish through MacDevBridge's MCP `events__publish` tool rather than opening a direct NATS socket. Pre-approve only that specific event-publish tool when unattended worker progress is required; do not disable approvals globally.

After the events service is healthy, apply `daemon-service-manage` to verify PM2 reboot persistence and run `pm2 save`. If first-time PM2 startup registration requires an administrator credential, treat only that credential prompt as a user-only blocker.

## Repair strategy

Classify before changing anything:

| Symptom | Likely layer | First action |
|---|---|---|
| repo missing | source | clone canonical repo |
| repo dirty | source | preserve it; do not auto-pull/reset |
| app builds but protected files fail | macOS TCC/signing | inspect signing/FDA; see lessons |
| `/healthz` green but tools fail | bridge/unlock | perform a real MCP tool call |
| ChatGPT OAuth callback silently fails | endpoint/issuer | check hostname stability and OAuth issuer |
| plugin saves but no tools appear | ChatGPT connector | inspect connection/auth fields and reconnect |
| `events__*` absent | federation | inspect `mcp-servers.json`, restart bridge, inspect `bridge_status.federation` |
| `events__publish` fails only in Codex sandbox | worker path | use federated MCP tool, not direct NATS |
| Chrome background tools say extension offline | browser bootstrap | install native host + load unpacked extension with computer-use |

Do not reinstall everything when one layer is broken. Repair the smallest failed layer and re-run the end-to-end verification.

## Source of truth

The actual Mac Developer Bridge checkout is authoritative for commands and supported fields. Default checkout:

```text
~/Workspace/neo/mac-developer-bridge
```

Canonical upstream used for a missing checkout:

```text
https://github.com/alexanderradahl/mac-developer-bridge.git
```

Before executing setup against an existing checkout, read its current `README.md`, `DEPLOY.md`, and relevant scripts because the product can evolve faster than this skill.
