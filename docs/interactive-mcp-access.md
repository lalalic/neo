# Interactive Neo MCP access

This is a provider-neutral capability. Z.ai, Claude, other browsers with Bash/HTTP tools, and local scripts can call **Neo MCP** through the same HTTPS JSON-RPC endpoint. There is no Agents Relay dependency.

## Issue a short-lived credential

For an interactive Z.ai chat, issue the access token **directly** on the trusted Neo Master terminal, without creating or finding a token file:

```sh
neo mcp token issue --stdout --client-name "Z.ai interactive"
```

`--stdout` intentionally displays the **one-hour access token** as a single line for the user to copy into a private chat. Do not run this command in a logging or shared terminal. The operator/master credential stays on Neo Master and the unused refresh token is revoked. There is no automatic renewal. The existing `--output` option remains available for unattended local scripts that require a private file.

Run locally on the trusted Neo Master Mac (never inside a third-party AI's cloud sandbox):

```sh
neo mcp token issue --output /tmp/neo-interactive-access.token
```

The command uses NeoY's existing local operator credential at
`~/Library/Application Support/NeoY/core-token` and its existing OAuth Authorization Code + PKCE endpoint. The access credential expires after **3600 seconds**; the unused refresh credential is immediately revoked. No token is printed. The output file is exclusive (`O_EXCL`) and mode `0600`. Do not put this file into a Git repository or shared storage.

For a different Neo gateway, supply `--origin https://your-neo-host` or set `NEO_MCP_ORIGIN`. Use `--client-name` for a human-readable interactive client label. The CLI does not start a browser or create a Relay Job.

Provide **only** the short-lived access token from the private file to an interactive client after the owner authorizes access. Treat the conversation as having sensitive credentials during that hour. Do not add credentials to shared bootstrap documents or system instructions.

## Verify with a real remote tool call

An interactive cloud agent must use its *actual* Bash/HTTP tool, not merely output curl examples. In every independent Bash tool call, set the token again inside that same call because some cloud tool environments do not persist shell variables.

For example, with `NEO_ACCESS_TOKEN` supplied privately within the same command:

```sh
curl -sS --max-time 20 https://neoy.qili2.com/mcp   -H 'Content-Type: application/json'   -H 'Accept: application/json, text/event-stream'   -H "Authorization: Bearer $NEO_ACCESS_TOKEN"   --data-binary '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

Next use `tools/call` `status`, then `tools/call` `shell` with `command=exec` and `args.command=neo bootstrap` **on Neo Master**, and follow the returned default rules and discovered Skills. Distinguish the cloud Bash filesystem from the Neo Master filesystem.

Inspect the JSON-RPC result and later verify real side effects. A text-only claim of having run commands is not proof.

## Renew interactively with the current Access Token

For an authorized `Z.ai interactive` client, while the current token is **still valid** and before the original **eight-hour** session deadline, the agent can invoke:

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

The public Z.ai adapter lives at `docs/z-chat/bootstrap.md`, published as `https://neoy.qili2.com/files/z-chat/bootstrap.md` through a read-only `z-chat` file mount. New Z.ai Full-Stack conversations can read it directly by URL instead of attaching a file. This URL contains no credentials. Uploading a file to Z.ai Cloud alone does not make it available in a new chat. The adapter does not duplicate the canonical Global AGENTS.md; it instructs Z to run `neo bootstrap` on the real Neo Master after authentication. On Neo Master, provision the mount through the existing `setup files mount z-chat /Users/chengli/Workspace/neo/docs/z-chat` command (public read-only), then verify an unauthenticated GET from the public HTTPS hostname.

No remote worker should fabricate Relay source IDs or task lifecycle events in an interactive chat. No automatic refresh or permanent user session is implied.
