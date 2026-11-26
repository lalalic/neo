# Hermetic Rust Harness bundle / clean Mac prefix (T018)

`neo-rs package stage ABSOLUTE_NEW_DIR` creates a **preview-only** macOS
native distribution without installing or changing the operator's `neo`
launcher. It requires a new destination outside the source checkout and a
readable local Git revision. It refuses existing paths, relative paths,
ancestors or descendants of the source Git repository.

## Bundle layout / source-of-truth

```text
bundle/
  bin/neo                 # Native Rust CLI executable (mode 0755)
  agents/...              # Committed public Agent definitions
  skills/...              # Committed public Skills, docs and scripts
  compute/...                 # Tracked optional compute asset descriptions
  manifest.json           # Version, commit, platform, architecture, counts
  README.md
```

- Every shipped Agent/Skill/GPU file is read from **Git HEAD blobs**, never
  an untracked developer file, current private Run, home directory, cached
  credential, noncanonical symlink or arbitrary recursive file copy.
- File names, modes, and path components are validated. Only tracked regular
  files with Git mode `100644` or `100755` can be copied. Failed staging
  removes the fresh output directory rather than leaving a partial candidate.
- Tracked Git symlinks are **never followed**. The sole current omitted
  external link `skills/iphone-helm` points to a separate repository; its
  relative path is named under `excludedExternalGitLinks` in the manifest.
  A clean machine must install this separate optional Skill itself. The
  preexisting legacy Node stager fails on this link; Rust does not package
  unstable external code or claim it is bundled.
- The separate Agency Agents catalog is also a declared optional local
  prerequisite for `neo agent list/search`; it is not secretly embedded.
- `NEO_HARNESS_ROOT` remains an explicit override for development. Ordinary
  use resolves the **canonical executable** (including the real target of
  a versioned `~/.local/bin/neo` symlink) to its bundled Agents/Skills root.
  Bootstrap and Eval require the independently installed compatible `agents-relay` CLI; no Relay executable or resources are bundled. No runtime `node`, `python`, npm or source checkout is needed for native
  Bootstrap, Skill Discovery, Project Discovery, Workspace and Help.
  Explicitly configured project `.mjs` preflight remains an extension with
  its own Node runtime prerequisite.

## Acceptance evidence (2026-11-23)

- 4 Rust distribution tests pass: source path safety, asset manifest integrity,
  missing private files, clean temporary HOME with Node removed from PATH,
  and a **versioned user-prefix** installation invoked through a symlink.
- The test host bundles **188 committed regular assets**, skips exactly one
  external Git link (`skills/iphone-helm`), and publishes the actual Mac OS
  and CPU architecture in the manifest. The compiled binary links only
  system libraries and frameworks (`libSystem`, `libiconv`, `CoreFoundation`).
- Full Rust integration suite **78/78** passed; strict Clippy passed;
  real isolated Rust Relay E2E passed (`foregroundAttached:true`, only one Job,
  no production SQLite touched).
- No actual operator home install, production launcher replacement, remote
  push, permission grant, background job or service restart was attempted.
  Full core command parity and release authorization remain T017/T019/T020.
