# Historical agent/platform lessons (consult only when relevant)

These are preserved observations from prior work, not universal startup instructions. Verify current Skill and CLI help before following historical platform details.

## Reflections

- 2026-09-19: ChatGPT thread creation must click a fresh browser chat before selecting the exact Project; the returned conversation URL is evidence, but `thread_id` remains the durable identity.
- 2026-09-19: Bind XChat project context once and let Agents Relay own managed worker lifecycle; child re-resolution or parallel lifecycle loops can split one PR objective and corrupt correlation.
- 2026-09-11: Preserve the distinction between a durable workflow and an autonomous worker. A queued command plan is not evidence that a producer, phone trigger, or model call ran.
- 2026-09-11: Agree on the CLI/config contract before parallel implementation, and request small reviewable patches early. Bind review approval to file bytes, not just filenames or a prose report.
- 2026-09-19: Browser-backed ChatGPT workers need a pure contract layer that separates requested from observed thinking level, binds every operation to a verified Project, and treats deleted thread identities as terminal tombstones before any selector adapter is added.

## Project learnings

- 2026-10-31: A third-party MCP OAuth session saved in one client cannot automatically authenticate Neo federation's independent HTTP MCP connection. For shared ChatGPT tools, bridge through the authorized client using a private profile; verify actual read-only tool execution and guard paid or mutating calls rather than treating tool discovery as authorization.
- 2026-10-29: Executable Node ESM CLIs installed as symlinks must compare the real path of argv[1] with import.meta.url. A global CLI symlink may otherwise exit successfully without executing its service-management action; integration tests must invoke the symlink itself.

- 2026-09-26: Chrome Web Store new-item uploads reject extension manifests containing a `key`; preserve the authoritative source package, derive a store-compatible upload artifact without that field, and verify the assigned item/version only after reopening the publisher dashboard.
- 2026-09-25: Chrome Web Store browser mechanics belong under the `browser-platforms` skill's `platforms/chrome-web-store`; keep the runner dry-run by default and require explicit authorization before upload, listing mutation, or review submission.
- 2026-09-26: Chrome Web Store editor controls expose labels through `aria-labelledby`/`label[for]` and save drafts as `Save draft`; shared flows must resolve accessible labels and verify the publisher-scoped item URL before mutating a listing.
- 2026-09-26: Chrome Web Store new-item uploads can reject an otherwise valid local extension package before an editor exists; report the visible package error (for example, a disallowed manifest `key`) as the blocker instead of misclassifying it as navigation failure.

- 2026-09-19: Existing ChatGPT thread operations must open one durable `thread_id` at a time, verify the observed Project before sending or reading, and report completion only from a normalized assistant message.
- 2026-09-19: Browser result retrieval must refuse active generation and require an observed message ID; a prior assistant bubble or synthetic fallback ID is not completion evidence.
- 2026-09-25: Computer-use demos should receive a declarative intent and keep fresh-UI verification plus playable-artifact checks as explicit gates; contract validation alone is not E2E evidence.
- 2026-09-25: Product-demo story contracts should emit Markcut Markdown plus semantic visible evidence, while rejecting automation-shaped fields and language so runtime navigation remains owned by downstream execution agents.
