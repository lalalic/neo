# Read-only Rust CLI Contract

| Command | Reference owner | Native parity |
|---|---|---|
| `neo skill list [--project PATH]` | `list-xchat-skills` | Resolved Skill catalog and dependency errors, array order |
| `neo bootstrap [--json] [--project PATH]` | `xchat-bootstrap.mjs` | Complete JSON metadata, exact Markdown bytes |
| `neo workspace show` | `neo-control.mjs` | JSON keys, resolved roots, fail-closed config |
| `neo project list` | `list-xchat-projects` | Independent direct Git roots only, ordered JSON rows |
| `neo project resolve NAME` | `list-xchat-projects` | Single project metadata, setup and lifecycle additions |
| `neo status` / `neo doctor` | `neo-control.mjs` | Legacy gateway, Node and Python diagnostics and exit codes |

All native commands are available via `neo-rs` only. Unknown or unsupported
commands fail closed. No implicit calls to Node/Python or writes to Project
metadata are made by Skill, Bootstrap, Workspace or Project discovery. Status
and Doctor intentionally invoke process presence probes, including `node
--version` and `python3 --version` for compatibility; their output rules must
be explicitly updated when the core Node dependency is removed at cutover.

Contract tests live under `crates/neo-cli/tests/`. The Rust fixtures compare
against the actual reference CLI and enforce JSON structure, stderr/exit code
and exact Bootstrap text. Live comparison is recorded in `quickstart.md`.
