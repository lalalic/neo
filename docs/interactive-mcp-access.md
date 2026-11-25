# Interactive Neo MCP access

Neo supports an MCP POST interface and a separate REST GET adapter. The external web-chat bootstrap is now **provider-specific**: Z.ai uses `bootstrap with neoy.qili2.com/files/z-chat/bootstrap.md` (MCP tools only), while DeepSeek uses `bootstrap with neoy.qili2.com/files/deepseek/bootstrap.md` (REST GET only). Both require real network tools and load `xchat-orchestrator` after verified Neo access. No Relay Job is created by bootstrap.

## Issue a short-lived credential

For an authorized interactive web chat, issue the access token **directly** on the trusted Neo Master terminal, without creating or finding a token file:

```sh
neo mcp token issue --stdout --client-name "Web chat interactive"
```

`--stdout` intentionally displays the **one-hour access token** as a single line for the user to copy into a private chat. Do not run this command in a logging or shared terminal. The operator/master credential stays on Neo Master and the unused refresh token is revoked. There is no unattended renewal. An eligible interactive access token can be renewed during a live turn via the POST renewal endpoint. The existing `--output` option remains available for unattended local scripts that require a private file.

Run locally on the trusted Neo Master Mac (never inside a third-party AI's cloud sandbox):

```sh
neo mcp token issue --output /tmp/neo-interactive-access.token
```

The command uses NeoY's existing local operator credential at
`~/Library/Application Support/NeoY/core-token` and its existing OAuth Authorization Code + PKCE endpoint. The access credential expires after **3600 seconds**; the unused refresh credential is immediately revoked. No token is printed. The output file is exclusive (`O_EXCL`) and mode `0600`. Do not put this file into a Git repository or shared storage.

For a different Neo gateway, supply `--origin https://your-neo-host` or set `NEO_MCP_ORIGIN`. Use `--client-name` for a human-readable interactive client label. The CLI does not start a browser or create a Relay Job.

Provide **only** the short-lived access token from the private file to an interactive client after the owner authorizes access. Treat the conversation as having sensitive credentials during that hour. Do not add credentials to shared bootstrap documents or system instructions.

## Verify with a real remote tool call

An interactive cloud agent must use its *actual* HTTP tool, not merely output curl examples. In every independent shell call, set the token again inside that same call because some cloud tool environments do not persist shell variables. Z.ai follows MCP POST. DeepSeek follows the separate REST GET instructions in its own bootstrap; do not assume a web search or preview tool can invoke dynamic REST GET URLs.

For example, with `NEO_ACCESS_TOKEN` supplied privately within the same command:

```sh
curl -sS --max-time 20 https://neoy.qili2.com/mcp   -H 'Content-Type: application/json'   -H 'Accept: application/json, text/event-stream'   -H "Authorization: Bearer $NEO_ACCESS_TOKEN"   --data-binary '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

Next use `tools/call` `status`, then `tools/call` `shell` with `command=exec` and `args.command=neo bootstrap` **on Neo Master**. Discover `xchat-orchestrator` in the returned Skill catalog and read its actual `SKILL.md` using Neo `fs` or `shell`. Loading the Skill is required for this **explicit web-chat starter**; it does not itself authorize a Relay Job or source changes. Distinguish the cloud tool filesystem from the Neo Master filesystem.

Inspect the JSON-RPC result and later verify real side effects. A text-only claim of having run commands is not proof.

## Renew interactively with the current Access Token

For an authorized interactive web chat that can make a real POST request, while the current token is **still valid** and before the original **eight-hour** session deadline, the agent can invoke:

```sh
# Supply the current short-lived token within this SAME Bash invocation.
curl --fail-with-body -sS --max-time 20 -X POST https://neoy.qili2.com/token/renew \
  -H "Authorization: Bearer $NEO_ACCESS_TOKEN" \
  -H 'Accept: application/json'
```

The response contains a **new** `access_token`, `expires_in`, and `session_expires_in`. The old token is immediately invalid; use the returned one for all subsequent calls. This response is sensitive. Do not publish it in chat prose or persistent logs. Refresh proactively while the token is active; this does not require or reveal a 30-day Refresh Token, a browser Cookie, or the Neo Master token. After the fixed session deadline or an expired/revoked token, the user must issue a new token. Ordinary OAuth clients retain their established refresh-token behavior; only explicitly issued interactive access can use this bounded rotation endpoint.

## Revoke when finished

```sh
neo mcp token revoke --file /tmp/neo-interactive-access.token
```

Successful revocation removes the private file. Expiration after one hour is the fallback if revocation cannot be completed. For a different origin, pass the same `--origin` as when issuing.

## Portable instructions versus platform adapters

The canonical general rules are `neo bootstrap` (including Global AGENTS.md, XChat Harness and the live Skill catalog). This guide describes generic OAuth and HTTPS MCP mechanics.

Two public web-chat adapters have separate URLs and transports: **Z.ai MCP** at `docs/z-chat/bootstrap.md` → `https://neoy.qili2.com/files/z-chat/bootstrap.md`, and **DeepSeek REST GET** at `docs/deepseek/bootstrap.md` → `https://neoy.qili2.com/files/deepseek/bootstrap.md`. Keep them separate: no REST fallback in the Z.ai file and no MCP POST in the DeepSeek file. Both public documents contain no credentials, require a private owner-provided short-lived token, and after verified Neo bootstrap load the discovered `xchat-orchestrator` Skill on Neo Master. The public read-only mounts are `setup files mount z-chat /Users/chengli/Workspace/neo/docs/z-chat` and `setup files mount deepseek /Users/chengli/Workspace/neo/docs/deepseek`. A public unauthenticated GET must be verified after publishing.

No remote worker should fabricate Relay source IDs or task lifecycle events in an interactive chat. No automatic refresh or permanent user session is implied.


## Registered device credentials and Dashboard

The canonical command family is now `neo token`. The historical
`neo mcp token issue|revoke` alias remains valid, and still issues one-hour
access tokens without retaining a refresh credential. Never provision
external model sessions with a renewable device grant.

On Neo Master, `neo token login` explicitly enrolls a local renewable
OAuth grant in a user-owned private file (0600, private directory). Use
`neo token status`, `neo token refresh`, or `neo token logout`. The
`access --stdout` command refreshes near expiry and requires explicit
secret-output consent. Rotation is serialized and persisted atomically;
a rejected or expired refresh requires re-enrollment.

Dashboard authentication belongs to the existing Neo Gateway and browser
entry point, not a separate CLI command. A normal browser may select
Remember this trusted browser during login. Node-specific OAuth enrollment
and revocation remain available through `neo token login --node NAME`
and `neo token logout --node NAME`; the Gateway validates the existing
node registration. No browser-launch command is required.
