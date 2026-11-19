# Neo Web Chat Bootstrap

**One-line starter for Z.ai, DeepSeek, or any other web chat:** `bootstrap with neoy.qili2.com/files/z-chat/bootstrap.md`

Resolve that address as `https://neoy.qili2.com/files/z-chat/bootstrap.md`. The intended outcome of this starter is a **verified Neo connection followed by activation of `xchat-orchestrator`**. Starting a chat is not proof of access.

**For:** interactive AI web chats, including https://chat.z.ai, https://chat.deepseek.com, and other providers. This public file is a **transport adapter**, not Neo's authoritative agent rules. The file contains no credentials. A web chat can use Neo only if its **actual tools** can make the necessary HTTPS requests; displaying a URL or proposing a command is not execution.

## 1. Verify your capabilities

1. Really read this document using an available URL reader or web tool, or use its full contents provided by the user. Do not claim a network fetch that did not occur.
2. Inspect the tools available **in this chat/session**. Do not assume a named provider offers MCP, Bash, arbitrary URL fetches, or tool calling merely because its API supports them.
3. Select **one** working route below; if both are available, prefer MCP POST. A web-search summary, cached snippet, or predicted response is not proof of tool execution.

## 2. Obtain a private, short-lived token

The authorized owner issues a **one-hour Neo MCP access token** on **Neo Master**, for example:

```sh
neo mcp token issue --stdout --client-name "Web chat interactive"
```

The owner may supply that temporary token in an explicitly authorized **private** conversation. If none is available, respond `NEO_AUTH_REQUIRED`. Never request the master/operator token, a password, cookies, or a refresh token. Never insert a real token into this public document.

## 3. Connect using the tools you actually have

**Route A — real HTTP POST / MCP client (preferred):** Connect to `https://neoy.qili2.com/mcp` using a real network tool. Send `Authorization: Bearer <TOKEN>`, `Content-Type: application/json`, and `Accept: application/json, text/event-stream`. Call, in order:

1. `{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}`
2. `{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"status","arguments":{}}}`
3. `{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"shell","arguments":{"command":"exec","args":{"command":"neo bootstrap"}}}}`

Use the currently valid token **in each independent call**; cloud shell variables may not persist.

**Route B — GET-only URL reader (including web chats with genuine URL fetching):** Neo also exposes the same remote-enabled MCP tools over GET. Percent-encode the path token and the full JSON `args` value; never treat these placeholder URLs as completed calls.

```text
GET https://neoy.qili2.com/mcp/rest/<TOKEN>
GET https://neoy.qili2.com/mcp/rest/<TOKEN>/status
GET https://neoy.qili2.com/mcp/rest/<TOKEN>/shell?args=%7B%22command%22%3A%22exec%22%2C%22args%22%3A%7B%22command%22%3A%22neo%20bootstrap%22%7D%7D
```

Use your **actual URL-reading tool** to fetch all three URLs in sequence. The first returns the visible tool descriptors; the next two call tools. Inspect the real JSON-RPC `result.content` and `isError` fields, not merely HTTP 200. Some web readers refuse private URLs, strip the path or query, cache responses, truncate long results, or do not support arbitrary URLs; if so, Route B is **not available**. Do not pretend otherwise.

**No real HTTP transport:** If the chat has neither MCP/HTTP POST nor a URL reader capable of dynamic outbound GET, respond `NEO_TOOL_UNAVAILABLE`. You cannot reach Neo through prompt text alone. An external client with real network tool support is required.

## 4. Load xchat-orchestrator after Neo bootstrap

After the three verified calls, find **`xchat-orchestrator`** in the dynamic `neo bootstrap` Skill catalog. Read its `SKILL.md` from the **exact `absolutePath` returned by Neo Master** using the existing Neo `fs` or `shell` tool through Route A or Route B (for example, `fs` with `{"command":"read","args":{"path":"<discovered-absolutePath>","encoding":"utf8"}}`). Read only needed referenced contracts. Do not guess a local path on the web-chat provider's machine, and do not infer successful loading from the catalog entry alone.

This starter is the user's **explicit selection** of `xchat-orchestrator` for this external chat; it does not change Neo's default policy against automatically loading that Skill in unrelated chats. Follow the loaded Skill's instructions for subsequent work; no Relay Job, repository binding, or other task is authorized by bootstrapping alone.

## 5. Prove bootstrap before project work

Only report `NEO_BOOTSTRAP_PASS` when you have **actually** obtained all four results: (1) a nonempty `tools/list` containing the required tools, (2) a successful `status` from Neo Master, and (3) the **complete** output of `shell` running `neo bootstrap` on Neo Master, and (4) the actual content of the discovered `xchat-orchestrator/SKILL.md`. Read and follow the returned Global AGENTS.md, XChat Harness instructions, dynamic Skill catalog, and `xchat-orchestrator`. If any step fails or output is truncated, report `NEO_BOOTSTRAP_BLOCKED` with the failed step and evidence; never invent success or execute the user's next project task.

A web chat's cloud Bash and files are **not** Neo Master's machine/files. Once verified, use Neo tools for real Neo actions; distinguish a submitted request from its completed result. Do not create Relay Jobs, schedules, spend money, or publish content without the applicable authorization.

## 6. Token expiry and privacy

Access tokens expire after about **one hour**. A client that supports actual authenticated **POST** can renew an eligible interactive token during an active user turn using `POST https://neoy.qili2.com/token/renew` with its current Bearer token (up to the session's absolute eight-hour limit). Replace the old token with the returned `access_token`; do not print it. A GET-only web reader **cannot renew through this GET interface**; ask the owner for a new short-lived token after expiry. Do not schedule background renewal.

**URL-path tokens are sensitive.** A GET URL carrying a token may be exposed to the web-chat provider, URL fetch service, logs, browser history, or a copied link. Use only an owner-approved private chat, short-lived credentials, and the minimum necessary tools. Never include the real token or credentialed URL in final replies, shared links, citations, logs, screenshots, or project artifacts.
