#!/bin/sh
# Optional host-local developer tooling; no service or MCP registration.
set -eu
version=1.6.4
prefix="$HOME/.local"
bin="$prefix/bin/codegraph"
if [ ! -x "$bin" ] || [ "$("$bin" --version)" != "$version" ]; then
    npm install --global --prefix "$prefix" "@colbymchenry/codegraph@$version"
fi
"$bin" telemetry off
python3 - <<'PY'
from pathlib import Path
import os
import tempfile

path = (Path.home() / ".agents/AGENTS.md").resolve(strict=True)
rule = "- CodeGraph: For structural code exploration, prefer CodeGraph when available. Use the actual Git worktree root (not the main checkout); lazily initialize with `codegraph init --yes --local-only ROOT`, run `codegraph sync --quiet ROOT` after edits before graph queries, and pass `--path ROOT` to queries. Bound results; use rg for literals or fallback. Verify source and git diff."
original = path.read_text()
lines = original.splitlines(keepends=True)
matches = [i for i, line in enumerate(lines) if line.startswith("- CodeGraph:")]
if len(matches) > 1:
    raise SystemExit("Duplicate CodeGraph rules; reconcile before installation")
if matches:
    lines[matches[0]] = rule + "\n"
else:
    lines.insert(lines.index("# Engineering Rules\n") + 1, rule + "\n")
updated = "".join(lines)
if updated != original:
    fd, name = tempfile.mkstemp(dir=path.parent, prefix=".codegraph-rule-")
    try:
        os.fchmod(fd, path.stat().st_mode & 0o777)
        with os.fdopen(fd, "w") as out:
            out.write(updated)
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)
print(f"CodeGraph rule ready: {path}")
PY
printf 'CodeGraph %s installed: %s\n' "$("$bin" --version)" "$bin"
