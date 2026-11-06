# Neo Project Run Contract

`neo project run` is the explicit foreground CLI entry point for creating or resuming one content-only Agents Relay Job and one Task for a project, then executing it until a verified terminal result. Project declarations in `project.run.json` define the accepted input type and restrictions. A project without a valid declaration is not enabled. The declaration is input validation metadata; the project's `graph.mmd` remains the sole authority for workflow ordering.

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

Neo invokes the installed `agents-relay` CLI through argv: it creates a shortcut Job (`--repo lalalic/neo`, overridable by `NEO_RELAY_REPOSITORY`) and then a Task with the canonical project graph. It then invokes `agents-relay job run --mode shortcut` as a foreground child, forwarding stdout/stderr and per-node events as they arrive. Exit 0 requires checking the authoritative Relay Job is `COMPLETED` and the bound Task is `SUCCEEDED`; non-success exit codes are forwarded (1 failure, 2 unverified success, 3 waiting event, 4 timeout, 5 interrupted). A repeated path verifies the Job repository/project/execution policy and Task input, output path and Agent Graph before resuming its bound Task. A fully completed bound Run returns success without rerunning completed work; if a verified Job exists but its Task does not, Neo resumes Task creation.

The live terminal stream is also appended to a mode-0600 `neo-project-run.log` in the same canonical Run. An observer can follow it with `tail -f <run-dir>/neo-project-run.log` while the foreground command runs. The log may contain private run content: never commit or publish it. When testing unmerged Relay changes use `NEO_RELAY_CLI=/absolute/path/to/agents-relay/dist/cli.js` so **both** setup commands and the foreground execution target the same local build; the default is the installed `agents-relay@latest`. Do not use this override to bypass approval or authorization gates.

Runs, source evidence, binding pointers, output, and diagnostics belong in ignored canonical project `runs/`. Source code changes and tests may use isolated worktrees; production runs must use the configured canonical Neo project tree.

## Project-specific permissions and existing flows

- **Content Distribution** accepts HTTPS source references. A public RS Root URL does not imply provider license, permission to download, asset rights, account authorization, or publication permission. Follow [content-distribution/AGENTS.md](../content-distribution/AGENTS.md), verify the licensed original and campaign rights, and retain distinct owner authorization before publishing. The CLI does not download or post.
- **Vlog** accepts an existing canonical run path only. Input media must be owner-approved for the intended private production. By default skip interactive Preview and independent Final QA/Final Review: Editor verifies and views complete video.md; Producer verifies and renders MP4, with Preview only on demand; Publisher is a conditional final Agent (WeChat Channels/XHS) with no review and acts only on explicitly authorized per-video/per-platform/account request. For an explicit `--no-review` run (Vlog path input only), require `source-manifest.json` owner approval and a private scope; create an immutable run-local `review-mode.json` with `private-render-test` / `UNREVIEWED` / `publicationAllowed:false`. Producer renders and verifies a real MP4 without interactive review; the separate Final QA Agent no longer runs. Publisher must skip the private-test Run even if a publication request exists. No publication is authorized, and retries cannot alter this policy. This explicit CLI path does not migrate the iCloud watcher or its Planner-backed Jobs.

Legacy watchers and project-local Planner Jobs continue to follow their existing project instructions. `neo project run` is a separate explicit user action and does not silently replace those workflows.
