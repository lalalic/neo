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

Enabled Neo Projects declare `versioning: { "mode": "local-git", "template": "run-template", "trackedArtifacts": [...] }` in `project.run.json` and maintain a project-owned `run-template/.gitignore`. The Runner copies this template into the canonical Run as `.gitignore` and initializes a private nested `.git/` with **no remote**. It never rewrites an existing Run template on resumption, and never copies run files or introduces revision folders. Existing Runs are adopted in place on the next explicit `neo project run` invocation, without moving original media.

The Runner alone stages the exact, named `trackedArtifacts`. Media, private inputs, credentials, logs, receipts not in the allowlist, and all other excluded files stay outside the Run Git object database. The default Vlog template ignores video, photos, source/produced audio, `input/`, `assets/`, `output/`, and private Relay bindings. A successful verified Relay Shortcut node `completed` event creates a local Git Commit (including a valid empty Stage Commit). No Worker must operate Git. The commit message records the Stage and Relay execution identity; replaying that same execution is idempotent. A checkpoint error stops the foreground Relay process; failed or waiting nodes do not create success commits. A completed bound Task without fresh node events may create one recovery commit for pending allowlisted files.

On optional Interactive Preview, the Producer first invokes `neo project review checkpoint --project vlog --path <run> --stage producer`. This re-runs the authoritative Stage validator and commits allowlisted artifacts **before** any Preview is sent; it returns a full 40-character Git Commit SHA. `markcut preview ... --delivery event --event-template <json> --commit-sha <SHA>` carries exactly that SHA to Neo Mobile and Relay. The Runner does **not** create another Stage Commit after the Preview request. It tags the verified SHA `review/rN` (annotated immutable tag), recording only `commitSha` and `requestId`. Resending the same SHA reuses the tag; a changed file requires a new Stage Commit and a new review. The entire Event Review identity is `commitSha` (`interactive.revision` also equals SHA). The 64-character `mediaHash` is only the compiled player cache locator and is never a review/approval identity; neither `revisionId` nor `contentHash` is accepted in Event Review requests. Standalone text-only previews retain their internal Markcut cache identity. Relay remains authoritative for decisions, Task lifecycle and continuation: a Preview receipt or Git tag is **not** approval.

**Media retention:** Git does not store ignored MP4/audio/image bytes. A previous review can compare and restore committed text/metadata, but replay of a previous video requires separately retained immutable media; a Git tag alone cannot recreate an ignored MP4. A changed output video must update the tracked production receipt's SHA-256 before its new revision can be reviewed. Do not imply old media is available from Git.

**Project/Run Git boundary:** each independent Neo Project has its own source `.git` and project `.gitignore` that excludes `runs/`. Nested per-Run Git repositories remain inside that ignored private directory; never stage or publish their private contents through Project source Git. Neo Harness Git no longer owns Vlog or Content Distribution source. The parent Harness's `.gitignore` and `scripts/guard-private-runs.mjs` are additional safeguards for Harness history, not substitutes for each Project's own ignore policy. Use the owning Project Git root for source reviews, commits and pushes. Private Run Git repositories must never acquire a publishing remote. Do not rewrite historic Run bindings merely because the source repository changed.

## Project-specific permissions and existing flows

- **Content Distribution** accepts HTTPS source references. A public RS Root URL does not imply provider license, permission to download, asset rights, account authorization, or publication permission. Follow the independent Content Distribution Project's `AGENTS.md`, verify the licensed original and campaign rights, and retain distinct owner authorization before publishing. The CLI does not download or post.
- **Vlog** accepts an existing canonical run path only. Input media must be owner-approved for the intended private production. By default skip interactive Preview and independent Final QA/Final Review: Editor verifies complete video.md without a player; Producer verifies and renders MP4, with Preview only on demand; Publisher is a conditional final Agent (WeChat Channels/XHS) with no review and acts only on explicitly authorized per-video/per-platform/account request. For an explicit `--no-review` run (Vlog path input only), require `source-manifest.json` owner approval and a private scope; create an immutable run-local `review-mode.json` with `private-render-test` / `UNREVIEWED` / `publicationAllowed:false`. Producer renders and verifies a real MP4 without interactive review; the separate Final QA Agent no longer runs. Publisher must skip the private-test Run even if a publication request exists. No publication is authorized, and retries cannot alter this policy. This explicit CLI path does not migrate the iCloud watcher or its Planner-backed Jobs.

Existing watcher entry points and project-local Planner Jobs follow their Project contracts. Previously bound Jobs may still refer to the former `lalalic/neo` identity; these require an explicit, read-back-verified Job migration rather than silent rebinding. See [Neo Harness and Project layout](neo-harness-project-layout.md).

Legacy watchers and project-local Planner Jobs continue to follow their existing project instructions. `neo project run` is a separate explicit user action and does not silently replace those workflows.

### Creative variant artifact allowlist

`versioning.trackedArtifacts` may list exactly `creatives/*/video.md` and
`creatives/*/qa.json` to include safe per-variant Markdown and QA under one
single `[a-z0-9-]+` subfolder. This is a narrow scoped pattern, **not** an
arbitrary recursive glob. The Runner rejects symlinked directories and files,
checks canonical Run containment, stages only these allowlisted paths and
records one Git SHA at each completed node. The project `.gitignore` must
continue ignoring private media, evidence, transcripts and arbitrary exports.
Old Runs keep their immutable `.gitignore`/Git history; they are never silently
migrated by a new template.
