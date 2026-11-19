# Z.ai → Neo Bootstrap (MCP POST)

**One-line Z.ai starter:** `bootstrap with neoy.qili2.com/files/z-chat/bootstrap.md`

Public instructions URL: `https://neoy.qili2.com/files/z-chat/bootstrap.md`.

This file is exclusively for Z.ai web chats with **real MCP tools or HTTP POST access to Neo MCP**. Use only MCP `tools/list` and `tools/call` for Neo operations. No REST GET fallback is defined here.

1. **Read these instructions with a real tool.** Z.ai cloud Bash/files are not Neo Master. If the chat cannot perform arbitrary outgoing HTTP POST, report `NEO_TOOL_UNAVAILABLE`; do not pretend to have executed curl.
2. **Short-lived credential:** The authorized owner issues a one-hour access token **on Neo Master** using `neo mcp token issue --stdout --client-name "Z.ai interactive"`, then supplies it only in the authorized private chat. If absent, report `NEO_AUTH_REQUIRED`. Never request or publish the master/operator credential, password, cookie, or refresh token.
3. **Call the real Neo MCP HTTPS endpoint:** `https://neoy.qili2.com/mcp`. For each call include `Authorization: Bearer <TOKEN>`, `Content-Type: application/json`, and `Accept: application/json, text/event-stream`. Cloud shell state may not persist; provide the active token in each separate tool invocation.
4. **Execute in order**, checking the actual responses rather than sample commands:
   - `{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}`
   - `{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"status","arguments":{}}}`
   - `{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"shell","arguments":{"command":"exec","args":{"command":"neo bootstrap"}}}}`
5. **Load xchat-orchestrator:** In the returned `neo bootstrap` Skill catalog, find `xchat-orchestrator` and its exact `absolutePath`. Read that `SKILL.md` through Neo `fs` or `shell` over MCP; do not guess a Z.ai cloud path. Follow its actual contents and relevant contracts. Selecting this bootstrap explicitly selects the Skill, but does not authorize a Relay Job or project changes.
6. **Completion evidence:** Only report `NEO_BOOTSTRAP_PASS` after nonempty tool discovery, successful `status`, complete `neo bootstrap` output, and the actual loaded Skill file. If any result is unavailable/truncated, report `NEO_BOOTSTRAP_BLOCKED` with the failed step. Wait for the user's task.

When the token expires, request another short-lived Neo MCP token from the authorized owner. Do not print token values or schedule renewals. Never confuse submitting an external task with completing it.
