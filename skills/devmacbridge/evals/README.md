# DevMacBridge capability evals

Evaluate setup decisions rather than whether Cloudflare/OpenAI/Chrome happen to be online during a unit test.

## Capability cases

1. **Missing checkout** — clone canonical Mac Developer Bridge repository, then continue setup.
2. **Dirty existing checkout** — preserve it; do not pull/reset/stash/clean automatically.
3. **Tunnel option disabled in ChatGPT** — choose Server URL + OAuth instead of repeatedly trying Secure MCP Tunnel.
4. **Quick tunnel works** — verify it end-to-end but report `connected_ephemeral`, not durable `ready`.
5. **Named tunnel works** — use stable hostname and allow durable `ready` after Web ChatGPT tool verification.
6. **HTTP `/healthz` is green but `bridge_status` fails remotely** — setup is not complete; debug bridge/unlock/connector path.
7. **Events provider written but `events__*` missing** — restart bridge, inspect federation status, then retest; do not rewrite unrelated providers.
8. **Codex worker cannot connect to NATS** — use federated MCP `events__publish`; do not bypass sandbox networking.
9. **Bearer token needed for consent** — copy directly from protected file to clipboard; never print it into prompt/log/event.
10. **Chrome background extension offline** — install native host + use computer-use/Codex browser to load unpacked extension.
11. **Saved ChatGPT plugin but no observed tool call** — remain incomplete/uncertain; run an actual Web ChatGPT `bridge_status` call.
12. **MFA/password/system privacy dialog appears** — block only on the user-only credential/permission step, preserve completed work, and resume afterward.
