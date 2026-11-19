# External AI child-thread bootstrap (XChat caller contract)

**When to load:** The active XChat conversation is orchestrating a child thread at a **different AI website** that needs Neo Master tools. A normal web chat without Neo work does not need this bootstrap.

## Ownership

- The parent XChat caller chooses whether the child needs Neo, authorizes any credential handoff, and verifies readiness **before** sending project tasks.
- WebHelm platform Actions create threads, submit turns, and return receipts; do not inject Neo-specific text into generic platform Actions.
- The **public, provider-neutral child bootstrap** is `https://neoy.qili2.com/files/z-chat/bootstrap.md` (the legacy `z-chat` URL is intentionally retained for all providers). It owns the connection procedure and fallback transport choices. Do not duplicate its protocol instructions here.
- The child's cloud terminal/browser/files are not Neo Master. An ordinary chat reply, URL display, or thread submission receipt does not prove Neo access.

## Starting any Z.ai, DeepSeek, or other web child that needs Neo

1. Verify the public bootstrap URL is reachable and that the target child platform supports the intended thread/action. Do **not** assume one platform's tools exist on another.
2. Start the child with the **same exact one-line message** for every provider:

   `bootstrap with neoy.qili2.com/files/z-chat/bootstrap.md`

   For Z.ai, use its installed `webhelm platform run z new-thread` Action when authorized. For DeepSeek or any other provider, discover and use its **actual** supported thread Action; do not invent one. Keep the created thread identity for continuation.
3. Verify that the child actually fetched the public instructions and identified an applicable network tool: authenticated HTTP POST/MCP, or dynamic URL-only REST GET. If it cannot genuinely fetch or invoke URLs, mark `NEO_TOOL_UNAVAILABLE` and do not send project work.
4. With the owner's authorization, issue a **fresh short-lived Neo access token on Neo Master** using `neo mcp token issue --stdout --client-name "Web chat interactive"` or `--output ABSOLUTE_PATH` to a private file. Never expose a long-lived master/operator token, password, or refresh credential. For file-backed handoff use restricted permissions and remove transient token/config files after submission. The token is intentionally disclosed only to that private external chat, with its provider's retention and network-access implications.
5. Submit the short-lived token in a **follow-up turn** to the same child thread. Do not mix credentials into the first generic bootstrap message or the public file.
6. Check the child's actual evidence: nonempty Neo `tools/list`, live Neo `status`, `shell exec neo bootstrap`, and the **read contents** of the discovered `xchat-orchestrator/SKILL.md` on Neo Master. The starter explicitly selects that Skill for this child, but does **not** authorize creating a Relay Job or modifying a repository. Report `NEO_BOOTSTRAP_PASS` only when all four succeed; otherwise hold at `NEO_AUTH_REQUIRED`, `NEO_TOOL_UNAVAILABLE`, or `NEO_BOOTSTRAP_BLOCKED`.
7. Only after verification, send the detailed project task to the **same verified child thread**, with the selected repository, applicable rules, scope, review path, permissions, and reporting route. Do not resend an ambiguous thread submission without checking its receipt.

**Z-specific compatibility:** The Z `new-turn` Action can continue an existing verified Z thread. Keep the caller-owned WebHelm session open through verification, then close only the session you created. Do not automatically create Relay Jobs, schedules, publish or spend money as part of bootstrap.

**Security and lifecycle:** The token remains a secret disclosed to the authorized child provider and its URL reader. An access token in the REST URL path may appear in request logs or the provider's history; prefer a Bearer header when a real HTTP client is available. Never place live tokens into Markdown, source control, logs, public URLs or status reports. The child bootstrap document owns expiry, renewal, and transport details; the parent owns consent and task handoff.
