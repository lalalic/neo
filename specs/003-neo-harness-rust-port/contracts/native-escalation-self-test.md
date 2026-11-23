# Native read-only local Escalation self-test

`neo-rs escalation test` now verifies the local model and Tool Use without
creating a managed work item, changing a user account, publishing messages or
modifying real project files.

- Generate an unpredictable 16-byte random nonce. Write it to a mode 0600
  file in a disposable mode 0700 self-test directory. The handoff contains
  **only the file path**, not the nonce.
- The model must request the single permitted `shell` tool command matching
  exactly `cat <test nonce file>`. The trusted test executor reads the file
  with `/bin/cat` using argument arrays, rejects all other commands, and
  returns a real observed Tool Result. No browser, payment, notifications,
  write operations or model-authored arbitrary Shell commands are executed.
- `resolved` requires a successful observed file-read Tool Result and evidence
  containing the **exact** random nonce. Guesses, wrong paths, unsupported
  tools and text-only model claims fail. The nonce is excluded from final
  CLI JSON; no conversation transcript or private file is persisted.
- Use the existing global inference flock. For native llama/MLX start the
  owned server in an isolated process group, then close and wait for cleanup
  before releasing the flock. For `external` require an explicit local
  `127.0.0.1:/v1` endpoint, and report `model_process_released:null`.
- Invalid CLI flags reject before any model is invoked. This is a stricter
  **read-only implementation** of the Node self-test, not an actual paid,
  account or browser test.

## Acceptance (2026-11-23)

- Six Rust self-test tests: real temporary file nonce, no guessing, strictly
  permitted tool call, no remote endpoint, invalid flags, real spawned
  `neo-rs escalation test` making localhost HTTP calls to a disposable
  mock model, and a private directory/ledger cleanup check.
- Full Rust suite **172/172**, original Node Escalation self-test/Learn/
  policy suite **28/28**, strict Clippy pass.
- No real production model, account, website or native background service
  was used. Interactive teaching remains separately open in T017.
