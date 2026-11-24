# Native interactive Escalation Learn (T017 sub-slice)

`neo-rs escalation learn` starts only in a real interactive terminal (TTY).
The entire owner/model/tool dialogue lives in memory and is discarded after
`/quit`, terminal EOF or error. The global inference flock, process-owned
llama/MLX server, explicit localhost endpoint, existing Shell/WebHelm/NeoY
Computer Use adapter, and native sanitized Case library are reused.

- `/tools on` and `/tools off` control whether the local model can request
  tools; a model trying to invoke tools while disabled is rejected.
- Tool batches are bounded to four; an identical failed tool action is
  not repeated without changed arguments. No model-produced transcript or
  plaintext account secrets are saved to the Case library.
- `/remember` asks the model for one sanitized structured candidate, shows
  a preview and requires an explicit owner `y/yes` confirmation before a
  `source:owner_taught, outcome:taught` record can be created or updated.
  Declining confirmation never creates a new private directory or Case.
- Automatic learning after `[VERIFIED]` is more conservative than the Node
  reference: a **new** read-only inspection (`cat`, `ls`, `stat`, `grep`,
  `git status/diff/log`, WebHelm session inventory, or native Computer Use
  state/list) must succeed after the model's first success claim. A second
  `[VERIFIED]` without a new successful tool result cannot save a lesson.
  Tool output and exact private details are sanitized before saving, and
  all saved guidance is still treated as untrusted on later Runs.
- The owner-specific Apple credential helper remains disabled unless the
  trusted caller explicitly enables the existing authorization setting;
  teaching never bypasses user consent or submits a login automatically.

## Acceptance evidence (2026-11-23)

- Seven native tests pass: owner-confirmed save, declined save, tool disable/
  enable, failed-tool dedupe, fresh-tool automatic verification, refusal of a
  bare model `[VERIFIED]`, and CLI non-TTY denial **before** model startup.
- Full Rust integration suite: **179/179**, strict Clippy passed.
- Original Node Learn/SelfTest/Experience reference tests **27/27** passed.
  All tests use synthetic model replies and private temporary files. No
  interactive production model, account or browser has been modified.
- Optional post-run structured Experience summarization and the full
  user-device integration matrix remain separate T017/T019 work; no launcher
  or production release has been changed.
