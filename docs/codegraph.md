# Optional CodeGraph CLI

For structural code discovery, use the host-local CodeGraph CLI. No Relay lifecycle, model provider, or MCP changes are required.

On an authorized development host, run `./scripts/install-codegraph.sh`. It installs the pinned CLI under `~/.local/bin` (ensure it is on PATH), disables anonymous telemetry, and reconciles one concise rule in `~/.agents/AGENTS.md`. It never modifies Codex global instructions.

Use the actual execution checkout, including a Relay or hotfix worktree:

```sh
root=$(git rev-parse --show-toplevel)
test -f "$root/.codegraph/codegraph.db" || codegraph init --yes --local-only "$root"
codegraph query --path "$root" --limit 8 taskNode
codegraph callers --path "$root" --limit 8 taskNode
codegraph explore --path "$root" --max-files 2 "taskNode"
# After edits, before relying on relationships:
codegraph sync --quiet "$root"
```

Initialize lazily only for structural queries, not every task. Never query main for a different worktree. Indexes stay local and ignored; remove them with their owning worktree (or use `codegraph uninit` on a retained checkout). Use bounded output and exact symbols; use `rg` for literals, unsupported languages, or missing CLI/index. Confirm graph findings in current source and review Git diffs.

Run `./scripts/verify-codegraph.sh`. The worktree smoke test checks isolation, synchronization and call relationships. This is a tool contract check, not a model token benchmark; compare identical tasks with matched model/routing and acceptance criteria before claiming token savings.
