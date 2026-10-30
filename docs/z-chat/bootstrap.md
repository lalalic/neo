# Z.ai → Neo Interactive Bootstrap

**Mode:** interactive Z.ai Full-Stack chat. This public file is a thin Z.ai adapter, not the canonical Neo instructions.

1. **Really read this entire URL** with an available web/Bash tool. Never pretend to have read it. Z.ai cloud Bash runs on a **different machine** from Neo Master. Do not create schedules, Relay Jobs, or autonomous background work.
2. **Neo MCP:** `https://neoy.qili2.com/mcp` (HTTPS JSON-RPC). It requires a **short-lived Neo OAuth access token**, which is never embedded here. If you do not have one, answer `NEO_AUTH_REQUIRED` and wait. Never request the Neo operator/master token, password, or refresh token.
3. The user or trusted Neo agent can issue a one-hour token **on Neo Master**, using `neo mcp token issue --stdout --client-name "Z.ai interactive"`. This explicitly prints **only** the one-hour access token directly to the trusted operator terminal; **no file is created**. The user can copy that temporary token into this private Z.ai chat. Never put it in shared logs, files, final replies, or Git. No automatic refresh.
4. In **each separate Z.ai Bash tool call**, re-supply the access token within **that same call** (cloud shell variables might not persist). Make real HTTPS POST calls with headers `Authorization: Bearer $NEO_ACCESS_TOKEN`, `Content-Type: application/json`, and `Accept: application/json, text/event-stream`. First call `{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}`; then `tools/call` for `status`. Inspect the actual HTTP and JSON-RPC results, not example code.
5. Next call Neo MCP `shell` with `{"command":"exec","args":{"command":"neo bootstrap"}}` **on Neo Master**. Read and follow its complete Global AGENTS.md, XChat Harness instructions and dynamically discovered Skill catalog. These are the authoritative **general** instructions; do not cache or copy them into this Z.ai-specific file.
6. Report the verified Neo identity and bootstrap status in concise Chinese, then **wait for the user's next task**. Use Neo MCP `shell`/`fs` for real Neo Master operations and independently verify outcomes. Z cloud files are not Neo files. No Relay events without a real assigned Relay execution source.

If authorization fails or expires, respond `NEO_AUTH_REQUIRED` and request a **new short-lived token only**. Never infer success from a submitted chat message.
