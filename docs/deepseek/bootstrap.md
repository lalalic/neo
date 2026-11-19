# DeepSeek Web Chat → Neo Bootstrap (REST GET only)

**DeepSeek starter:** `bootstrap with neoy.qili2.com/files/deepseek/bootstrap.md`

You are in **chat.deepseek.com**. This is a **GET-only** Neo connection procedure. Do not choose another transport, suggest posting JSON to an endpoint, or ask for an Authorization header. The only Neo tool-call URL format for this bootstrap is:

```text
https://neoy.qili2.com/mcp/rest/<TOKEN>/<tool>?args=<URL_ENCODED_JSON_OBJECT>
```

Use `https://neoy.qili2.com/mcp/rest/<TOKEN>` to list tools. Replace placeholders with real values only in requests made by a genuine available URL-fetching tool. This public document contains **no credentials**.

## Execute, do not describe

1. Read this document completely. Check whether **your current DeepSeek chat has a real tool for fetching arbitrary, dynamic HTTPS GET URLs** (not just web-search summaries, indexed content, or a preview of text). Never claim a request succeeded without seeing its HTTP response and JSON data.
2. If your chat cannot make such GET requests, report exactly `NEO_TOOL_UNAVAILABLE` with the actual limitation. Do not switch to POST, fabricate results, or assert that reading this file gives you access to Neo.
3. If no short-lived Neo access token was supplied privately by the authorized owner, report `NEO_AUTH_REQUIRED`. The owner can create a one-hour token **on Neo Master**, outside DeepSeek, with `neo mcp token issue --stdout --client-name "DeepSeek interactive"`. Never request the master/operator token, password, refresh token, or cookie. Do not disclose the temporary token in your response or citations.

## Invoke REST GET in this exact order

The URL path token and the JSON `args` query value must be percent-encoded separately. Do **not** use a normal web-search query as a substitute for direct fetching. A real GET returns JSON with top-level `result` or `error`. HTTP 200 alone is not proof the tool succeeded.

**1. Discover Neo tools (GET):**

```text
https://neoy.qili2.com/mcp/rest/<TOKEN>
```

Parse the live JSON `result.tools`. Verify the list includes `status`, `shell`, and `fs`. An empty list is not successful authentication.

**2. Verify Neo Master identity (GET):**

```text
https://neoy.qili2.com/mcp/rest/<TOKEN>/status
```

Read `result.content`, check `result.isError != true`, and confirm a real Neo Master response.

**3. Run the actual Neo bootstrap (GET):**

```text
https://neoy.qili2.com/mcp/rest/<TOKEN>/shell?args=%7B%22command%22%3A%22exec%22%2C%22args%22%3A%7B%22command%22%3A%22neo%20bootstrap%22%7D%7D
```

The encoded `args` above is `{"command":"exec","args":{"command":"neo bootstrap"}}`. Parse the live `result.content`; check `isError`, command exit code, and whether the **complete** Global AGENTS.md, XChat Harness rules, and discovered Skill catalog were returned. If the reader truncates or rewrites the output, report `NEO_BOOTSTRAP_BLOCKED`.

**4. Load `xchat-orchestrator` from Neo Master (GET):**

Find `xchat-orchestrator` in the actual bootstrap catalog and copy its exact `absolutePath`. Then make another GET call to:

```text
https://neoy.qili2.com/mcp/rest/<TOKEN>/fs?args=<PERCENT_ENCODED_JSON>
```

Set `args` to `{"command":"read","args":{"path":"<DISCOVERED_ABSOLUTE_PATH>","encoding":"utf8"}}`; percent-encode that **entire JSON object** for the query value, including the discovered file path. Verify the returned file contents really describe `xchat-orchestrator`. Read further referenced contracts only as needed. Your cloud file system is not Neo Master's file system.

## Completion contract

Only report `NEO_BOOTSTRAP_PASS` when all four steps have real, complete evidence: discovered tools, Neo status, Neo bootstrap, and actual `xchat-orchestrator/SKILL.md` contents. The starter explicitly selects `xchat-orchestrator` for the next task, but it **does not** itself authorize a Relay Job, repository changes, publishing, spending, or background work. After success, wait for the user's next task. On failure, report `NEO_AUTH_REQUIRED`, `NEO_TOOL_UNAVAILABLE`, or `NEO_BOOTSTRAP_BLOCKED` and state which step failed.

**Security:** A token inside a GET URL can leak to the web-chat provider, URL reader, logs, history, copied links, or citations. Use only an owner-approved private chat and short-lived credentials. Never echo credentialed URLs or tokens. GET-only clients **cannot renew** through this interface; ask for a new short-lived token after expiration. Do not schedule work or treat a generated answer as evidence of a tool call.
