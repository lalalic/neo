# Neo Project Run Contract

`neo project run` is the explicit CLI entry point for creating one content-only Agents Relay Job and one Task for a project. Project declarations in `project.run.json` define the accepted input type and restrictions. A project without a valid declaration is not enabled. The declaration is input validation metadata; the project's `graph.mmd` remains the sole authority for workflow ordering.

## Invocation

```sh
neo project run --url="$PRIVATE_SOURCE_URL" --project=content-distribution
neo project run --path=/absolute/neo/vlog/runs/2026-11-03-episode --project=vlog
```

Set `PRIVATE_SOURCE_URL` in a private shell to the actual HTTPS reference; do not commit URLs or credentials to this public repo.

Options accept either `--flag=value` or `--flag value` in any order. Use `--dry-run` to validate and preview without writing or contacting Relay. The configured workspace in `~/.config/neo/workspace.json` determines `neoRoot`; neither the caller's current directory nor the CLI installation directory selects the project.

## Project declaration

Each enabled project has `project.run.json` with `schemaVersion: 1` and one `input.type`:

- `url` declares allowed schemes and may opt in to `resumePath: true` so an existing bound URL Run can be resumed by `--path` without another Job. The current URL contract requires HTTPS and rejects credentials and invalid/control characters. The URL is only an acquisition reference; it is not evidence of licensing, owner permission, or permission to download, publish, or monetize.
- `path` declares `path.base: "runs"` and `path.datedRunDirectory: true`. The selected path must be an existing dated run directory whose real path stays inside that project's canonical `runs/` tree.

The CLI validates required project files (`AGENTS.md`, `README.md`, and `graph.mmd`), real path containment, and declaration shape. The wrapper does not copy media or reproduce graph edges.

## Run and Relay behavior

URL input creates a unique dated directory under the project's canonical `runs/`, with private mode-0600 source evidence and objective/input documents. The complete URL stays in the private evidence file and is never placed on Relay argv or printed. Path input references an existing run and never replaces its files. Both forms write a private atomic binding pointer containing only the project/run and Relay Job/Task identifiers and private artifact paths.

Neo invokes the installed `agents-relay` CLI through argv: it creates a shortcut Job (`--repo lalalic/neo`, overridable by `NEO_RELAY_REPOSITORY`) and then a Task with the canonical project graph. Task creation is Relay's normal wake path. Neo does not call `job run`, maintain a second Job/Task status store, cancel failed work, or claim completion from the local binding. A repeated path verifies the Job repository/project/execution policy and Task input, output path and Agent Graph with Relay before returning the existing IDs; if the verified Job exists but its Task does not, Neo resumes Task creation.

Runs, source evidence, binding pointers, output, and diagnostics belong in ignored canonical project `runs/`. Source code changes and tests may use isolated worktrees; production runs must use the configured canonical Neo project tree.

## Project-specific permissions and existing flows

- **Content Distribution** accepts HTTPS source references. A public RS Root URL does not imply provider license, permission to download, asset rights, account authorization, or publication permission. Follow [content-distribution/AGENTS.md](../content-distribution/AGENTS.md), verify the licensed original and campaign rights, and retain distinct owner authorization before publishing. The CLI does not download or post.
- **Vlog** accepts an existing canonical run path only. Input media must be owner-approved for the intended private production; retain existing preview approval, final QA, publication authorization, and platform receipt gates. This explicit CLI path does not migrate the iCloud inbox watcher or its Planner-backed Jobs.

Legacy watchers and project-local Planner Jobs continue to follow their existing project instructions. `neo project run` is a separate explicit user action and does not silently replace those workflows.
