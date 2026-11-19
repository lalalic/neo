# External AI child-thread bootstrap (XChat caller contract)

**When to load:** The active XChat conversation is orchestrating a child thread at a **different AI website** that needs Neo Master tools. A general-purpose chat without Neo work requires no Neo bootstrap.

## Ownership and provider selection

- The parent chooses the correct public bootstrap by **target web-chat provider**, authorizes any short-lived credential handoff, and verifies readiness before assigning project work.
- Generic WebHelm platform Actions only create threads, submit turns, and report receipts; do not insert Neo-specific instructions into shared Actions.
- Child-side bootstrap documents own their transport details and error handling. The provider's cloud browser/shell/files are **not** Neo Master; a displayed URL or message submission is not proof that a tool ran.

| Child | First message | Only supported Neo transport in its bootstrap |
| --- | --- | --- |
| Z.ai (`chat.z.ai`) | `bootstrap with neoy.qili2.com/files/z-chat/bootstrap.md` | MCP `tools/list` / `tools/call` over HTTP POST |
| DeepSeek (`chat.deepseek.com`) | `bootstrap with neoy.qili2.com/files/deepseek/bootstrap.md` | REST GET `/mcp/rest/<TOKEN>/<tool>` |

For any other provider, inspect its actual network tools and choose or create a supported provider-specific bootstrap; do not infer MCP or REST availability from the name.

## Child handoff and verification

1. Verify the selected provider's **specific public bootstrap URL** is reachable. Create the child using that platform's real `new-thread` Action; for Z.ai, the installed `webhelm platform run z new-thread` Action is supported. Discover DeepSeek's actual Action before using it, rather than inventing commands.
2. Send **only** the provider-specific first message above. Keep the child thread identity. The first turn cannot be considered bootstrapped merely because a web search retrieved the instructions.
3. Verify the child can actually make **that provider's specified network requests**. For DeepSeek, do not allow HTTP POST as an alternative. If only search snippets or static URL previews are available, report `NEO_TOOL_UNAVAILABLE` and stop.
4. With owner authorization, issue a one-hour interactive Neo token on Neo Master using `neo mcp token issue --stdout --client-name "Web chat interactive"` or `--output ABSOLUTE_PATH` (private file with restricted permissions). Submit only the fresh short-lived token in a **second private turn** to the same child. Never hand off master/operator or refresh credentials, copy tokens into source/logs, or publish them in reports. Remove token/config handoff files after use.
5. Verify four observed results: nonempty remote tool discovery containing `status`, `shell` and `fs`, a real Neo `status` result, the complete `shell` result for `neo bootstrap`, and actual contents of `xchat-orchestrator/SKILL.md` read from its **discovered absolutePath** via Neo. The starter explicitly selects that Skill, but bootstrap itself does not authorize a Relay Job or repository mutations. Require `NEO_BOOTSTRAP_PASS` with evidence; otherwise retain the exact failure (`NEO_AUTH_REQUIRED`, `NEO_TOOL_UNAVAILABLE`, or `NEO_BOOTSTRAP_BLOCKED`).
6. **Only after verification**, submit the project task as `new-turn` on the **same verified child thread**, with selected repository/root, rules, scope, permissions, parent-review URL and reporting route. For an ambiguous/pending submission, inspect the receipt and the existing thread **before retry**; do not duplicate turns.

**Security:** Query-path tokens in DeepSeek REST URLs can appear in the provider's retrieval logs or copied links; POST Bearer tokens are also sensitive to the provider. Authorize disclosure only to the correct private child. The individual bootstrap owns transport and token-expiry behavior. Close only the caller-created WebHelm session after a verified handoff, and do not create jobs/schedules, publish, or spend money simply because bootstrap ran.
