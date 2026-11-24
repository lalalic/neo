# Native CLI interaction black-box acceptance

Run against the built Rust executable:

```sh
cargo build --offline -p neo-harness-cli --bin neo-rs
node scripts/verify-rust-harness-interaction-blackbox.mjs
node scripts/verify-rust-harness-interaction-blackbox.mjs --live-ui
```

The default suite creates disposable HOME, workspace, marker, loopback model
endpoint, and local media. `--live-ui` additionally calls the installed Neo.app
for explicitly read-only media preview and accessibility state; no managed
review notification, Relay job creation, UI text insertion or click is used.

## Verified

1. Native `escalation test` reads an actual nonce via its tool, verified by
   the synthetic HTTP model response; does not write Challenge history.
2. Native handoff invokes actual shell against its fixture-only working
   directory, saves a terminal Challenge and sanitized Experience, and exposes
   both via the native history CLI.
3. Invalid resolved response without evidence is rejected, records one failed
   attempt, and does not replay the already executed tool.
4. Native `project tts` creates a private real macOS speech artifact, verifies
   audio stream and duration independently with ffprobe, and refuses overwrite.
5. Actual Neo.app Markcut read-only audio Preview operation reaches `ready` /
   `complete`. Acceptance is compilation/receipt, not visual pixel verification.
6. Actual Neo.app Computer Use lists apps and returns an accessibility snapshot
   of Finder with app identity, state ID and elements.
7. Installed Rust Relay standalone `review run` executes an isolated synthetic
   provider process and returns PASS/CHANGE_REQUIRED/BLOCKED with exit 0/10/20
   and matching JSON output files. This is a dependency contract, not a new
   Neo Harness reviewer or managed Final Review proof.

Actual text insertion in a disposable TextEdit document was not verified:
application accessibility was available but the target document could not be
unambiguously identified, so no input was sent. A stalled AppleScript probe
was terminated. The initial plain-Markdown preview fixture was rejected by
Markcut's scene grammar; the actual audio fixture reached ready instead.
No product regression was inferred from either incomplete UI test.

## Outstanding

- Managed Final Review through a real Relay Job: isolated daemon rejects the
  live Codex execution flag and this test must not bypass that ownership gate.
- Real model inference (local model executable exists, model weights not
  established by this acceptance); interactive teaching/learning and actual UI
  mutation. Synthetic model transport tests do not verify model judgment.
- Real browser setup-agent, human preview/review decision as explicitly
  authorized, Docker / GPU / Compute Web live paths and installed CLI cutover.
