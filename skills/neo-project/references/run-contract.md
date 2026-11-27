# Neo Project Run Contract

`neo project run` creates or resumes **one ordinary Relay Job** with a fixed
**Coordinator** Task (using Relay's returned numeric Task ID) and the selected project Agent Graph (`graph.mmd` by default),
then activates it. Creation is atomic in Relay SQLite; there is **no separate
Shortcut Job, initial Planner, separate foreground node runner, or `executionMode`**.
The command returns the durable `ACTIVE`/`COMPLETED` status without waiting for
all Agents to finish. Relay immediately dispatches dependency-ready DAG Tasks
on their predecessor's terminal event, subject only to available Worker
capacity and human Review; QUEUED is a recovery state, not another global
Job scheduler admission. The job's Final Review and Git Merge remain controlled
by its normal independent policies.

**Local Git and remote boundary:** Neo passes `--repo` as the selected project's
local Git basename and `--project-root` as its canonical absolute Git root.
The Coordinator creation and activation both use the same canonical
Neo workspace root, avoiding symlink-induced execution-context mismatches.
New Relay Jobs and Coordinator Tasks use globally numeric IDs; historical Run
bindings are verified, never silently migrated. The removed `--no-github`,
`--github-repo` and `--pr` options are not sent by `neo project run`.

**Installed Relay CLI:** Neo invokes the independently installed native `agents-relay` CLI on PATH, or an explicit absolute `NEO_RELAY_EXECUTABLE` override. Relay owns its CLI, resources, and daemon deployment; Neo neither bundles nor installs Relay.

**Git-root-only Job identity:** Every Neo Project is an independent Git repository. The runner sends `--repo LOCAL_ROOT_NAME` and `--project-root CANONICAL_GIT_ROOT`; it never sends the retired Job `--project-path`. On reattachment it checks the saved Relay Job’s `repository` and `projectRoot` against the selected independent Git root before starting or reporting a bound Run. `--path ABSOLUTE_RUN_DIR` selects private Run input, **not** a Job subproject identity. Coordinator workspace-root is an execution support path, not repository discovery.
Final Review, local merge, and SQLite `COMPLETED` require no origin, PR or
network access. Only after `COMPLETED`, Relay may inspect a configured
`origin` and push a verified `main` fast-forward; failures are retried
separately without changing Job/Task lifecycle. Neo neither pushes nor
interprets the presence of an origin as publication permission.

**Declared DAG execution:** A Project Run executes an existing Project contract, not a new requirements-driven Job. No Spec Kit or independent requirements Preflight Review is required. The runner validates the project declaration, selected Graph, Run input, and applicable project-specific checks; it supplies Relay's internal `--preflight=true` on Coordinator creation. The flag is not a caller option or persisted state. Dry-run is read-only; stage, approval and publication gates remain unchanged.

`--title` sets the human-readable title at creation. Otherwise Neo uses the
project and canonical private Run folder, never the source URL or secret token.
Resuming a bound Run verifies the Job, Coordinator input, output and Graph; it
cannot create a duplicate Job or silently change title or policy.

Project declarations in `project.run.json` define the accepted input type and restrictions. A project without a valid declaration is not enabled. The declaration may additionally define `graphs: { "name": "graph-name.mmd" }` and `defaultDag: "name"`, with `graph.mmd` retained as the canonical default fallback. The selected file is the sole authority for that Run's workflow ordering. `--dag NAME` resolves a named graph; without it, the project default is used. The private Run binding persists the choice and rejects switching DAGs on resume.

The optional Relay Job routing switches `--prefer-adapter codex`, `--prefer-provider NAME`, `--prefer-model ID`, `--prefer-profile NAME`, and `--prefer-reasoning EFFORT` are passed through at atomic Job creation as soft routing hints, not executor overrides. Script nodes keep their declared executor. On an existing bound Run, explicitly supplied hints must match the stored preferences; use Relay Job update to change them, not a new Job. Project-owned identity, Coordinator, preflight, and review flags are not arbitrary passthrough arguments.

## Invocation

```sh
neo project run --url="$PRIVATE_SOURCE_URL" --project=content-distribution --dag=promotion
neo project run --project=content-distribution --dag=growth  # autonomous search; no URL required
neo project run --path=/absolute/neo/vlog/runs/2026-11-03-episode --project=vlog --title="加拿大周末随拍"
# Start the same Coordinator immediately and stream Task messages in this terminal:
neo project run --path=/absolute/neo/vlog/runs/2026-11-03-episode --project=vlog --foreground
```

Set `PRIVATE_SOURCE_URL` in a private shell to the actual HTTPS reference; do not commit URLs or credentials to this public repo.

Options accept either `--flag=value` or `--flag value` in any order. `--dag` is optional and only valid for a project that declares that name. It does not introduce a new scheduler or Agent type. A named DAG can explicitly opt into source-free starts with `dagInputs: { "growth": { "type": "discovery" } }`; only such a DAG may omit both `--url` and `--path`. `source-reference.json.kind` is then `discovery`, without a fabricated source URL; the Researcher must source real reference URLs itself. Use `--dry-run` to validate and preview without writing or contacting Relay. Use `--foreground` (mutually exclusive with `--dry-run`) to run the same ordinary Reconciler immediately in the terminal and stream events until the Job reaches a terminal state; Ctrl+C interrupts local workers but leaves the Job durable for recovery. `NEO_ROOT` selects the parent directory of independently Git-rooted Projects. It defaults to `~/Workspace`, can be saved as `neoRoot` in `~/.config/neo/workspace.json`, and may be overridden by the `NEO_ROOT` environment variable. On Neo Master the saved value is `~/Workspace/neo`. Neither the caller's current directory nor the Harness installation directory selects the project. Legacy monorepo project resolution is not supported.

## Project declaration

Each enabled project has `project.run.json` with `schemaVersion: 1` and one `input.type`:

- `url` declares allowed schemes and may opt in to `resumePath: true` so an existing bound URL Run can be resumed by `--path` without another Job. An explicit `preparedPath: true` additionally permits a new Job against an already populated canonical private Run with the nonempty list of Run-relative regular files declared by `input.preparedPathRequiredFiles`; partial evidence, empty files, path traversal, and links escaping the Run are rejected. A discovery-enabled DAG may start from a prepared directory with none of these files. Domain validation and authorization remain with the project. The current URL contract requires HTTPS and rejects credentials and invalid/control characters. The URL is only an acquisition reference; it is not evidence of licensing, owner permission, or permission to download, publish, or monetize.
- `path` declares `path.base: "runs"` and `path.datedRunDirectory: true`. The selected path must be an existing dated run directory whose real path stays inside that project's canonical `runs/` tree.

The CLI validates required project files (`AGENTS.md`, `README.md`, and `graph.mmd`), selected named graph real-path containment, and declaration shape. Named graph filenames must stay within the project and may not be arbitrary paths or symlinks outside it. The wrapper does not copy media or reproduce graph edges.

## Run and Relay behavior

URL input and explicitly enabled source-free `discovery` inputs create unique dated directories under the project's canonical `runs/`, with private mode-0600 source evidence and objective/input documents. The complete URL stays in the private evidence file and is never placed on Relay argv or printed. Path input references an existing run and never replaces its files. Both forms write a private atomic binding pointer containing the project/run, selected DAG when configured, Relay Job/Task identifiers, and private artifact paths.

Neo invokes the installed **Rust** `agents-relay` CLI using argv with the owning
independent local Git repository name (for example `vlog`) and its canonical
Git root via `--project-root`. An optional origin is inspected by Relay only
after `COMPLETED`, never as Job identity; an explicit repository override must
match the local project name.
Only `neo project run` may create a Coordinator. It makes one `job create` call with a validated `--project-run-manifest` pointing to the Project-owned `project.run.json`, and `--coordinator-graph-file`,
`--coordinator-input-file`, `--coordinator-output-path`,
`--coordinator-project-root` and `--coordinator-workspace-root`; Relay persists the Job and Coordinator Task in a
single SQLite transaction in DRAFT state. Neo saves the private Run binding,
verifies the Task, saves its numeric ID in the private run binding, then calls ordinary `job run --id JOB --task-id TASK_ID`
to activate it and publish a wake event. In `--foreground` mode it instead invokes the same Relay `job run --foreground` CLI directly, without a background scheduler wait; Job binding and resumption remain unchanged. The private Run input and result
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

## Project-owned review and authorization

`neo project run --review` enables Relay Interactive Review for the new Job; `--no-review` disables it. If omitted, `project.run.json` may declare boolean `interactiveReviewEnabled` (default false). The owning Agent declares `interactive_review: true` in its effective frontmatter (default false). Relay computes both flags at execution claim and supplies the result to Model and Script Agents, enforcing admission before preview delivery. No Run-local review policy file is needed. Existing bound Jobs retain their policy; explicit conflicting flags on resume are rejected.

The optional boolean `reviewEnabled` sets the independent Relay Final Review default (true when absent). Neo translates it to the existing Relay Job Final Review option. Interactive Review and artifact validation are independent of that policy. No project-specific authorization files are generated. Existing historical bindings are not rewritten.

The project owns all source acquisition, integrity, usage and publication rules, including ingestion manifests and platform authorization. Neither a source reference nor a Stage review authorizes external writes. Existing watcher entry points and project-local Planner Jobs follow their Project contracts. Previously bound Jobs with obsolete identities require an explicit, verified migration rather than silent rebinding. See [Neo Harness and Project integration](harness-integration.md).

### Creative variant revisions

Creative variants follow the same Run `.gitignore` boundary: text and QA files under `creatives/` are committed unless ignored; media and private data should be ignored in the project-owned Run template. There is no special `trackedArtifacts` pattern list. Existing Runs retain their own immutable `.gitignore` and local Git history; template changes never silently overwrite them.

## Project-owned source selection (`--source`)

`neo project run --project NAME --source SOURCE` is a **generic Neo CLI selector**, not a Neo-integrated XHS/TikTok provider. The independent project's `project.run.json` declares each supported named source and its chosen discovery DAG, JSON config and Run-local brief filename:

```json
{
  "sources": {
    "example-collection": {
      "dag": "growth",
      "config": "config/example-collection.json",
      "runFile": "growth-source-brief.json"
    }
  }
}
```

The selected DAG must declare `dagInputs.<dag>.type=discovery`. Neo validates the source name, project-relative config path and JSON *before* creating a Run. It stages the configured JSON as the declared private, 0600 Run file and records the source name/brief in `source-reference.json`; the first Agent follows the brief, rather than generic discovery. No source-provider specifics belong in the CLI. `--source` is for **new** Runs and cannot combine with `--url` or `--path`; a bound Run remains source-immutable. A previously unbound, partially staged Run can resume via `--path` only if its recorded source and private brief exactly match the current declared config. `--dry-run` validates selection without creating files, jobs or platform side effects. Missing source declaration, mismatched DAG, unsafe config or disabled discovery fail closed. Source selection does not grant license, upload permission or publishing authorization.
