# Neo Project Run Contract

`neo project run` creates or resumes **one ordinary Relay Job** with a fixed
**Coordinator** Task (using Relay's returned numeric Task ID) and the canonical project `graph.mmd`,
then activates it. Creation is atomic in Relay SQLite; there is **no separate
Shortcut Job, initial Planner, foreground node runner, or `executionMode`**.
The command returns the durable `ACTIVE`/`COMPLETED` status without waiting for
all Agents to finish. Relay immediately dispatches dependency-ready DAG Tasks
on their predecessor's terminal event, subject only to available Worker
capacity and human Review; QUEUED is a recovery state, not another global
Job scheduler admission. The job's Final Review and Git Merge remain controlled
by its normal independent policies.

`--title` sets the human-readable title at creation. Otherwise Neo uses the
project and canonical private Run folder, never the source URL or secret token.
Resuming a bound Run verifies the Job, Coordinator input, output and Graph; it
cannot create a duplicate Job or silently change title or policy.

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

Neo invokes the installed `agents-relay` CLI using argv with the owning
independent local Git repository name (for example `vlog`) and its canonical
Git root via `--project-root`. GitHub origin is optional remote metadata, never
the Job identity; an explicit repository override must match the local project name.
It makes one `job create` call with `--coordinator-graph-file`,
`--coordinator-input-file`, `--coordinator-output-path`,
`--coordinator-project-root`, `--coordinator-workspace-root` and
`--coordinator-shared-root`; Relay persists the Job and Coordinator Task in a
single SQLite transaction in DRAFT state. Neo saves the private Run binding,
verifies the Task, saves its numeric ID in the private run binding, then calls ordinary `job run --id JOB --task-id TASK_ID`
to activate it and publish a wake event. The private Run input and result
paths remain unchanged. The owner sees a Job ID immediately, with live
progress, Review decisions, failures, and eventual completion in the standard
Relay Jobs dashboard and JEL.

The Coordinator is **not** a leased Worker and cannot consume a Worker slot.
Each DAG node is an Agent-named, independently durable Task. Script and Model
Task nodes use the same execution events, retries, human `review.preview`
and recovery as any other Relay Task. Node terminal events continue directly
to ready successors (forks can launch concurrently); only capacity exhaustion,
unsatisfied dependencies or a human Review stop progression. There is no
Shortcut receipt format or special mobile review wake route.

A DRAFT Job whose binding is saved but whose activation failed is retried
idempotently. Once ACTIVE, re-invoking the Project Run checks the binding
and returns the current Job state; it does not start another runner. When
COMPLETED, it returns reused status. No process exit is mistaken for Job
completion. Normal Git Merge and Final Review apply without modification.

## Local Run Git versioning

Enabled Neo Projects declare `versioning: { "mode": "local-git", "template": "run-template" }` in `project.run.json` and maintain a project-owned `run-template/.gitignore`. The Runner copies this template into the canonical Run as `.gitignore` and initializes a private nested `.git/` with **no remote**. It never rewrites an existing Run template on resumption, and never copies run files or introduces revision folders. Existing Runs are adopted in place on the next explicit `neo project run` invocation, without moving original media.

The private Run Git repository is initialized with its ignored media and
secret paths excluded. A stage Agent can explicitly call `commitRunStage` after
verification to record descriptive stage source revisions; Project Run itself
no longer streams `shortcut.node` events or automatically commits stage files.
Never treat a Git commit as human approval, and never automatically commit
working files merely because Review was requested. The Run Git helper rejects
symlinks, submodules and unexpected pre-staged files.

Agent Workers request Interactive Review with `agents-relay review interactive --path PATH --id JOB --task-id TASK --execution-id EXEC` (which calls Neo `review.preview`) for the current Relay Task execution. The Neo wrapper reuses Markcut compilation,
the Markcut UI, Neo Mobile inbox and Relay's existing
internal `review.interactive.begin/wait/fail/abort` CLI. It does **not** run
`git add`, `git commit`, `git tag`, or stage validation. Standalone
`review.preview({path})` is view-only without a phone notification. Relay
suspends the original Task in `AWAITING_DECISION` and resumes after an
accepted execution-bound approval or changes request. A delivery receipt
does not imply approval. The Review event is bound only to `jobId`, `taskId` and `executionId`; no Git SHA, separate Invocation ID or review snapshot is required.
Markcut remains the underlying media preview; Agents call Relay CLI to request managed Review. Neo Wrapper validates the Relay-bound event template and passes an opaque Events Bus envelope to Markcut and Neo Core/Mobile; neither transport interprets Relay identities or Review policy.

Neo Runner automatically maintains .ghost.* as a global rule in every private
Run Git .git/info/exclude, independent of project templates; existing Run
repositories are migrated in place. Ghost Markdown is never committed
for review. Explicitly verified stage revisions can be committed by their owning Agent;
Project Run itself does not auto-commit them.

**Media retention:** Git does not store ignored MP4/audio/image bytes. Normal Stage Git commits can restore committed text/metadata, but a Review Preview creates no commit or tag. Replaying old preview media requires separately retained immutable media; a Stage Git commit alone cannot recreate an ignored MP4. A changed output video must update its production receipt before Stage verification. Do not imply old media is available from Git.

**Project/Run Git boundary:** each independent Neo Project has its own source `.git` and project `.gitignore` that excludes `runs/`. Nested per-Run Git repositories remain inside that ignored private directory; never stage or publish their private contents through Project source Git. Neo Harness Git no longer owns Vlog or Content Distribution source. The parent Harness's `.gitignore` and `scripts/guard-private-runs.mjs` are additional safeguards for Harness history, not substitutes for each Project's own ignore policy. Use the owning Project Git root for source reviews, commits and pushes. Private Run Git repositories must never acquire a publishing remote. Do not rewrite historic Run bindings merely because the source repository changed.

## Project-specific permissions and existing flows

- **Content Distribution** accepts HTTPS source references. A public RS Root URL does not imply provider license, permission to download, asset rights, account authorization, or publication permission. Follow the independent Content Distribution Project's `AGENTS.md`, verify the licensed original and campaign rights, and retain distinct owner authorization before publishing. The CLI does not download or post.
- **Vlog** accepts an existing canonical run path only. Input media must be owner-approved for the intended private production. By default skip interactive Preview and independent Final QA/Final Review: Editor verifies complete video.md without a player; Producer verifies and renders MP4, with Preview only on demand; Publisher is a conditional final Agent (WeChat Channels/XHS) with no review and acts only on explicitly authorized per-video/per-platform/account request. For an explicit `--no-review` run (Vlog path input only), require `source-manifest.json` owner approval and a private scope; create an immutable run-local `review-mode.json` with `private-render-test` / `UNREVIEWED` / `publicationAllowed:false`. Producer renders and verifies a real MP4 without interactive review; the separate Final QA Agent no longer runs. Publisher must skip the private-test Run even if a publication request exists. No publication is authorized, and retries cannot alter this policy. This explicit CLI path does not migrate the iCloud watcher or its Planner-backed Jobs.

Existing watcher entry points and project-local Planner Jobs follow their Project contracts. Previously bound Jobs may still refer to the former `lalalic/neo` identity; these require an explicit, read-back-verified Job migration rather than silent rebinding. See [Neo Harness and Project layout](neo-harness-project-layout.md).

Legacy watchers and project-local Planner Jobs continue to follow their existing project instructions. `neo project run` is a separate explicit user action and does not silently replace those workflows.

### Creative variant revisions

Creative variants follow the same Run `.gitignore` boundary: text and QA files under `creatives/` are committed unless ignored; media and private data should be ignored in the project-owned Run template. There is no special `trackedArtifacts` pattern list. Existing Runs retain their own immutable `.gitignore` and local Git history; template changes never silently overwrite them.
