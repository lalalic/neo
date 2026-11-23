# Native authorized Escalation Tool Executor (T017 sub-slice)

`escalation_tool_executor` is a Rust adapter for the *existing* local Shell,
WebHelm and NeoY Computer Use capabilities. It does not create a browser,
Accessibility daemon, remote command server, session database or credential
manager, and does not run unless invoked by the future trusted Escalation
execution pipeline.

## Authority and process safety

- `shell` executes an explicitly model-requested local command in the original
  working directory via argument-array `/bin/zsh -lc`; commands that attempt
  to print `USER_ACCOUNTS`/`USER_PASSWORDS` or dump process environment are
  rejected, and the child never inherits those account/password variables.
  Shell remains a powerful authorized tool, **not a sandbox**; only use it
  when the caller has explicitly permitted autonomous local repair.
- `webhelm` uses the existing CLI with structured arguments. A JavaScript
  payload is permitted only with `session exec SESSION_ID`, passed via a
  bounded private stdin pipe, never command-line arguments or a temporary
  source file. Invalid command shape or overlong code fails before execution.
- `computer_use` delegates directly to the allowlisted native NeoY `computer`
  MCP facade, reusing the existing local loopback Gateway. Unknown commands
  and non-object arguments are rejected before any network request.
- The special `credential_fill` tool defaults to denied and only accepts an
  existing WebHelm session ID if the trusted caller explicitly authorized
  Apple Account field fill. Candidate account credentials come from the
  owner's local environment or test-injected synthetic settings, require one
  unambiguous match, and are sent only over the authorized child's stdin.
  It refuses non-App Store Connect/Apple ID frames, never submits the login
  form, and redacts known secret values from all returned text. It does not
  prove a real Apple login until separately accepted on a test session.
- The bounded subprocess utility has private stdin <=128 KiB, output <=512
  KiB per stream and a 90-second tool call bound. Escalation tool children
  are created in a separate OS process group; the group is terminated on
  timeout or when background descendants retain captured output pipes after
  the direct child exits. Other CLI subprocesses (PM2 control, packaging,
  TTS) retain their original process-group ownership.
- No raw tool stdout, stderr, source JS, browser session credential or
  transcript is written to durable Escalation Case/Challenge evidence by
  the Tool Executor. Model decisions and public outcomes must still pass the
  separate evidence-normalization and redaction gates before persistence.

## Acceptance evidence (2026-11-23)

- 11/11 disposable Tool Executor tests passed: Shell result without transcript
  file, credential-environment blocking, WebHelm argv/stdin separation and
  invalid-operation rejection, native Computer Use allowlist, default denied
  Apple credential fill, synthetic authorized Apple frame checks and masked
  diagnostics, owned process-group timeout, background pipe recovery and
  private stdin bounds. All browser executables/providers were mocked; no
  production browser, account or macOS desktop action was used.
- Full native Rust integration suite: **141/141 passing**; strict
  `cargo clippy --workspace --all-targets --offline -- -D warnings` passes.
- Original reference `neo-stateless-agent.test.mjs` plus
  `neo-mcp-local.test.mjs`: **18/18 passing**.
- This sub-slice does not demonstrate complete Escalation execution, dynamic
  owned-model startup or real local-model E2E. T017 remains open.
