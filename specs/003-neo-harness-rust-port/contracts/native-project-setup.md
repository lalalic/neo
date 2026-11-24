# Native Project setup-agent browser handoff (T017 sub-slice)

`neo-rs project setup-agent NAME` reuses the native Project resolver, then
opens an explicitly selected local Project's `setup/bootstrap.md` in a
ChatGPT browser setup URL. It deliberately does **not** submit a ChatGPT
message, start an Agent, create a Relay Job or automate browser actions.

- The selected name must resolve to a legitimate direct Neo Project whose
  canonical setup Bootstrap path exists. No arbitrary relative path,
  unconfigured Project, missing Bootstrap or unidentified Project is accepted.
- The UTF-8 prompt and percent-encoded `https://chatgpt.com/?prompt=...`
  query are **semantically and byte-for-byte URL equivalent** to the original
  Node implementation. They ask the browser Agent to read the Bootstrap,
  check existing state and seek required permissions before proceeding.
- The native launcher invokes `/usr/bin/open -a 'Google Chrome' URL` through
  an argument array and checks its exit status. No shell interpolation,
  automatic prompt submission or silent fallback to another browser.
- Unit acceptance uses an injected fake browser-opener; the real Google
  Chrome application was **never launched** during testing.

## Acceptance (2026-11-23)

- Four native tests: URL and prompt equality with the Node reference,
  missing/relative Bootstrap rejection, propagated fake Chrome failure and
  invalid CLI arguments before any browser invocation. All pass.
- Entire Rust suite **160/160**, original Node control tests **15/15**,
  strict Clippy `-D warnings` passed. No live browser state changed.
- This closes one native CLI surface in T017. Escalation interactive Learn,
  self-test and optional taught-experience parity remain open; T019/T020
  continue to govern production release acceptance and cutover.
