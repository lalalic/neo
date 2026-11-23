# Rust native Skill ZIP packager (T017 sub-slice)

`neo-rs skill package SKILL_DIR OUTPUT.zip` replaces the old Python helper
for an **explicit** Web ChatGPT Skill export. It does not create a service,
install plugins or change any user configuration.

- The source is an existing Skill directory with a regular, non-symlink
  `SKILL.md`. Input may use an absolute path, relative path or `~/` prefix.
- Recursively include only UTF-8 text files without NUL bytes. Skip hidden
  files and directories, `node_modules`, `__pycache__`, `.git`, `.venv`,
  `.pytest_cache`, `.mypy_cache` and **all symlinks**. No binary content or
  external symlink target can be archived.
- The archive root is the selected Skill directory's basename, exactly as
  required by the old Web ChatGPT importer. Native ZIP32 headers and DEFLATE
  compressed streams use deterministic paths and CRC32 checksums.
- Bound each file to 8 MiB, combined text payload and ZIP to 32 MiB, and
  total entries to 10,000. A ZIP32 overflow fails before publication.
- Publish the archive via private temporary file and exclusive hard link,
  never silently overwrite an existing ZIP. Output has mode `0600`.
  This explicit no-overwrite behavior is safer than the previous Python
  helper's overwrite policy.

## Acceptance (2026-11-23)

- 3 disposable Rust integration tests: **all pass**. Valid ZIP metadata and
  extracted UTF-8 content exactly match the original Python-generated archive
  under `/usr/bin/unzip`. A separate test confirms external symlink payloads
  and dependency trees are excluded; existing output is never replaced.
- Native command runs with Node excluded from PATH and requires no Python,
  npm or third-party archiver executable. Only its checked-in Rust crates
  (flate2/CRC32) provide ZIP compression.
- Full Rust acceptance after this slice: **81/81 integration tests**, strict
  `cargo clippy ... -D warnings` passes; real isolated Rust Relay Job/foreground
  E2E still passes without touching production state.
- T017 remains open for local Escalation and other native coordination
  commands; this slice does not authorize releasing or installing a launcher.
