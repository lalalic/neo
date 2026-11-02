# External AI child-thread bootstrap (XChat caller contract)

**When to load:** The active ChatGPT conversation is acting as an orchestrator and will create or reuse a child thread on a **different AI website** to perform work using Neo Master tools. This is **not** Agents Relay worker routing. A general-purpose AI chat that does not need Neo tools requires no Neo bootstrap.

## Ownership

- **This XChat caller** decides whether the child needs Neo, builds an appropriate first message, and verifies readiness before handing off tasks.
- **WebHelm platform Actions** only create threads, send turns, and verify message/thread receipts. Do not add Neo-specific boilerplate to any generic `new-thread` Action.
- **The child-side bootstrap document** defines provider-specific Neo connection/authentication. Do not duplicate its OAuth, token renewal, or transport protocol in this reference.
- The Neo Project supplies **task** context only after the child is verified, not as an assumption that a newly created third-party chat can run Neo commands.

## Z.ai child that needs Neo access

1. Read the canonical public Z-side instructions in `docs/z-chat/bootstrap.md`. The public URL for Z is `https://neoy.qili2.com/files/z-chat/bootstrap.md`; check that it is reachable, and never invent a URL. Confirm the current Neo command options with `neo mcp token issue --help` or the installed CLI's actual usage.
2. Obtain a **fresh short-lived Neo MCP access token** from Neo Master, with the user's authorization to connect this private Z child to Neo. Use `neo mcp token issue --client-name "Z.ai interactive"` and the supported `--stdout` (interactive trusted handoff) or `--output ABSOLUTE_PATH` (file-backed handoff). When using a file, create it only in a restricted temporary location; build a temporary WebHelm JSON `--config` with private file permissions; wipe/delete both immediately after submission. Never print token contents through tools, commit, copy to a normal log, or send to a parent/status report. Z receives the token **in its private bootstrap chat**, a deliberate third-party disclosure; do not do this for unrelated public Z chats.
3. Create an ordinary Z thread with the installed `webhelm platform run z new-thread` Action, sending a **bootstrap-only first turn** constructed from the verified URL and token. Example **with placeholder, not a live credential**:

   `Bootstrap from https://neoy.qili2.com/files/z-chat/bootstrap.md, token: <fresh-one-hour-Neo-access-token>. Read the complete bootstrap document using your tools, connect to Neo MCP, run Neo bootstrap and verify tool access. Do not start project work. Report NEO_BOOTSTRAP_PASS only after genuine tool evidence; otherwise NEO_AUTH_REQUIRED or BLOCKED with the cause.`

4. Keep the created thread ID/URL. A successful WebHelm submit receipt **does not** prove the child is bootstrapped. Check the actual Z response for direct, verified Neo `tools/list`, `status`, and `neo bootstrap` evidence. If the child cannot access tools, is still generating, or reports missing auth, stop at **BLOCKED/PENDING** without forwarding the project task.
5. **Only after bootstrap verification**, send the detailed task as a `z new-turn` to the **same** verified Z thread. Include project path, relevant AGENTS/contracts, scope, permissions, parent-review URL, and any required reporting route. Reuse the current thread for continuation; do not create another unbootstrapped thread.
6. Preserve the caller-owned WebHelm session until the handoff is verified, then close the exact session you opened. For ambiguous/pending submissions, inspect or resume according to the Z Action's documented behavior; **do not resend an uncertain new-thread/new-turn**.

**Security and scope:** A short-lived token in Z's chat transcript is still a secret disclosed to Z.ai. Only give it to a Neo-authorized private child, not to public prompts, Run reports, PRs, Git commits, analytics, or unrelated people. The token may expire; renewal rules are owned by the Z-side bootstrap document. No master/operator token or refresh credential is ever shared. No auto-post, spending, account/profile changes or financial actions are authorized merely because child bootstrap succeeded.

## Other external AI providers

For every other provider, look up its **actual** child bootstrap contract on demand. Do not substitute Z instructions or invent a token flow. Transport success, provider bootstrap success, and task completion are **three separate states**, each requiring its own evidence.
