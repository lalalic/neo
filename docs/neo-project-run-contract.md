# Neo Project Run Contract

`neo project run` is the explicit foreground CLI entry point for creating or resuming one content-only Agents Relay Job and one Task for a project, then executing it until a verified terminal result. The optional `--title` (or `--title=TEXT`) sets the readable Relay Job title at **creation time**, independently of the numeric Job ID. If omitted, Neo formats the project and canonical Run folder into a default title, such as `Vlog · 2026 11 08 new unused iPhone media run3`. This never exposes a private source URL or URL token. Resuming an existing bound Run keeps its original Job title and does not create or rename a Job. Titles must be 1–120 printable characters.

Project declarations in `project.run.json` define the accepted input type and restrictions. A project without a valid declaration is not enabled. The declaration is input validation metadata; the project's `graph.mmd` remains the sole authority for workflow ordering.

## Invocation

```sh
neo project run --url="$PRIVATE_SOURCE_URL" --project=content-distribution
neo project run --path=/absolute/neo/vlog/runs/2026-11-03-episode --project=vlog --title="加拿大周末随拍"
```

Set `PRIVATE_SOURCE_URL` in a private shell to the actual HTTPS reference; do not commit URLs or credentials to this public repo.

Options accept either `--flag=value` or `--flag value` in any order. Use `--dry-run` to validate and preview without writing or contacting Relay. `NEO_ROOT` selects the parent directory of independently Git-rooted Projects. It defaults to `~/Workspace`, can be saved as `neoRoot` in `~/.config/neo/workspace.json`, and may be overridden by the `NEO_ROOT` environment variable. On Neo Master the saved value is `~/Workspace/neo`. Neither the caller's current directory nor the Harness installation directory selects the project. Legacy monorepo project resolution is not supported.

## Project declaration

Each enabled project has `project.run.json` with `schemaVersion: 1` and one `input.type`:

- `url` declares allowed schemes and may opt in to `resumePath: true` so an existing bound URL Run can be resumed by `--path` without another Job. An explicit `preparedPath: true` additionally permits a new Job against an already populated canonical private Run with `campaign.json` and `evidence/original-source.json`; project-specific source, license and publication checks still run at their own stages. The current URL contract requires HTTPS and rejects credentials and invalid/control characters. The URL is only an acquisition reference; it is not evidence of licensing, owner permission, or permission to download, publish, or monetize.
- `path` declares `path.base: "runs"` and `path.datedRunDirectory: true`. The selected path must be an existing dated run directory whose real path stays inside that project's canonical `runs/` tree.

The CLI validates required project files (`AGENTS.md`, `README.md`, and `graph.mmd`), real path containment, and declaration shape. The wrapper does not copy media or reproduce graph edges.

## Run and Relay behavior

URL input creates a unique dated directory under the project's canonical `runs/`, with private mode-0600 source evidence and objective/input documents. The complete URL stays in the private evidence file and is never placed on Relay argv or printed. Path input references an existing run and never replaces its files. Both forms write a private atomic binding pointer containing only the project/run and Relay Job/Task identifiers and private artifact paths.

Neo invokes the installed `agents-relay` CLI through argv: it creates a shortcut Job using the owning **independent project Git repository**. If the repository has a GitHub `origin`, the GitHub repository identity is used; otherwise it uses `local/<project>` and local-only Relay mode. The optional `NEO_RELAY_REPOSITORY` overrides this identity explicitly. Neither new Vlog nor Content Distribution Jobs default to `lalalic/neo`. It then creates a Task with the canonical project graph and invokes `agents-relay job run --mode shortcut` as a foreground child, forwarding stdout/stderr and per-node events as they arrive. Exit 0 requires checking the authoritative Relay Job is `COMPLETED` and the bound Task is `SUCCEEDED`; non-success exit codes are forwarded (1 failure, 2 unverified success, 3 waiting event, 4 timeout, 5 interrupted). A repeated path verifies the Job repository/project/execution policy and Task input, output path and Agent Graph before resuming its bound Task. A fully completed bound Run returns success without rerunning completed work; if a verified Job exists but its Task does not, Neo resumes Task creation.

The live terminal stream is also appended to a mode-0600 `neo-project-run.log` in the same canonical Run. An observer can follow it with `tail -f <run-dir>/neo-project-run.log` while the foreground command runs. The log may contain private run content: never commit or publish it. When testing unmerged Relay changes use `NEO_RELAY_CLI=/absolute/path/to/agents-relay/dist/cli.js` so **both** setup commands and the foreground execution target the same local build; the default is the installed `agents-relay@latest`. Do not use this override to bypass approval or authorization gates.

Runs, source evidence, binding pointers, output, and diagnostics belong in ignored canonical project `runs/`. Source code changes and tests may use isolated worktrees; production runs must use the configured canonical Neo project tree.

## Local Run Git versioning

Enabled Neo Projects declare `versioning: { "mode": "local-git", "template": "run-template" }` in `project.run.json` and maintain a project-owned `run-template/.gitignore`. The Runner copies this template into the canonical Run as `.gitignore` and initializes a private nested `.git/` with **no remote**. It never rewrites an existing Run template on resumption, and never copies run files or introduces revision folders. Existing Runs are adopted in place on the next explicit `neo project run` invocation, without moving original media.

The Runner stages **all non-ignored changes inside the private Run Git repository** using `git add -A`. The Run's `.gitignore` excludes original media, private inputs, rendered outputs and other sensitive data. Changes to any non-ignored source or generated file, regardless of the producing Agent, enter the same revision. The Runner rejects symlinks/submodules and unexpected pre-staged changes. A verified Relay Shortcut Stage completion creates a Git Commit (an empty Stage Commit is allowed); replay of the same Stage execution is idempotent.

Managed Interactive Preview uses `review.preview({path,relay:{jobId,taskId,executionId}})`
for the current Relay Task execution. The wrapper reuses Markcut compilation,
the Markcut UI, Neo Mobile inbox and Relay's existing
`review.interactive.begin/wait/ready/fail/abort` CLI. It does **not** run
`git add`, `git commit`, `git tag`, or stage validation. Standalone
`review.preview({path})` is view-only without a phone notification. Relay
suspends the original Task in `AWAITING_DECISION` and resumes after an
accepted current-invocation approval or changes request. A delivery receipt
does not imply approval. The transport field historically called `commitSha`
now holds a 40-character **opaque review token** (generated per invocation),
not a Git SHA; Markcut separately checks the compiled content hash.
Legacy `markcut.preview` remains callable with its existing syntax.

Neo Runner automatically maintains .ghost.* as a global rule in every private
Run Git .git/info/exclude, independent of project templates; existing Run
repositories are migrated in place. Ghost Markdown is never committed
for review. Normal verified Stage completions still have their separate
Run Git commits and Stage validation.

**Media retention:** Git does not store ignored MP4/audio/image bytes. Normal Stage Git commits can restore committed text/metadata, but a Review Preview creates no commit or tag. Replaying old preview media requires separately retained immutable media; a Stage Git commit alone cannot recreate an ignored MP4. A changed output video must update its production receipt before Stage verification. Do not imply old media is available from Git.

**Project/Run Git boundary:** each independent Neo Project has its own source `.git` and project `.gitignore` that excludes `runs/`. Nested per-Run Git repositories remain inside that ignored private directory; never stage or publish their private contents through Project source Git. Neo Harness Git no longer owns Vlog or Content Distribution source. The parent Harness's `.gitignore` and `scripts/guard-private-runs.mjs` are additional safeguards for Harness history, not substitutes for each Project's own ignore policy. Use the owning Project Git root for source reviews, commits and pushes. Private Run Git repositories must never acquire a publishing remote. Do not rewrite historic Run bindings merely because the source repository changed.

## Project-specific permissions and existing flows

- **Content Distribution** accepts HTTPS source references. A public RS Root URL does not imply provider license, permission to download, asset rights, account authorization, or publication permission. Follow the independent Content Distribution Project's `AGENTS.md`, verify the licensed original and campaign rights, and retain distinct owner authorization before publishing. The CLI does not download or post.
- **Vlog** accepts an existing canonical run path only. Input media must be owner-approved for the intended private production. By default skip interactive Preview and independent Final QA/Final Review: Editor verifies complete video.md without a player; Producer verifies and renders MP4, with Preview only on demand; Publisher is a conditional final Agent (WeChat Channels/XHS) with no review and acts only on explicitly authorized per-video/per-platform/account request. For an explicit `--no-review` run (Vlog path input only), require `source-manifest.json` owner approval and a private scope; create an immutable run-local `review-mode.json` with `private-render-test` / `UNREVIEWED` / `publicationAllowed:false`. Producer renders and verifies a real MP4 without interactive review; the separate Final QA Agent no longer runs. Publisher must skip the private-test Run even if a publication request exists. No publication is authorized, and retries cannot alter this policy. This explicit CLI path does not migrate the iCloud watcher or its Planner-backed Jobs.

Existing watcher entry points and project-local Planner Jobs follow their Project contracts. Previously bound Jobs may still refer to the former `lalalic/neo` identity; these require an explicit, read-back-verified Job migration rather than silent rebinding. See [Neo Harness and Project layout](neo-harness-project-layout.md).

Legacy watchers and project-local Planner Jobs continue to follow their existing project instructions. `neo project run` is a separate explicit user action and does not silently replace those workflows.

### Creative variant revisions

Creative variants follow the same Run `.gitignore` boundary: text and QA files under `creatives/` are committed unless ignored; media and private data should be ignored in the project-owned Run template. There is no special `trackedArtifacts` pattern list. Existing Runs retain their own immutable `.gitignore` and local Git history; template changes never silently overwrite them.
