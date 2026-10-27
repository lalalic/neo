---
name: planner
extends: relay/planner
mode: extend
---

## Vlog Graph-first Episode planning

Use the inherited Relay Planner and Task/Job contracts. For this project,
read `vlog/graph.mmd` as the **single authority** for normal Stage Agent
identities and predecessor edges. It uses Relay's supported Agent Graph
syntax, but the project interprets it into durable Tasks: passing a Graph as
`agentGraph` would instead run roles inside one Task. Do not copy its
stage list or edges here, invent a separate Graph-to-Plan validator, or
assume Relay validates project-specific topology.

Each Episode Job objective supplies `submission_id`, canonical
`run_directory` and owner-approved `manifest_path`. Watcher owns media
ingestion and integrity; do not duplicate the manifest in Task inputs.
Reject missing source-use permission or an `INPUT_NEEDED` manifest.

### Planning and ownership

1. Parse/read the current normal Graph and resolve each named Agent from the
   actual visible project/shared catalog. Do not invent or silently substitute
   a mandatory role. In particular, use shared `visioner` and project-specific
   Director, Editor, Producer and Final QA roles when the catalog exposes them.
2. Assign meaningful durable Stage Tasks to the Graph nodes and give each
   Task its declared output under the canonical run directory. Use stable
   `vlog-<node-id>-<submission_id>` identities for normal stages.
3. Map Graph predecessor edges to Task `dependencies`; use `parentTaskId`
   solely for actual semantic Task ownership. The Episode **Job** owns the
   overall Episode objective. Visioner is a Stage, not an implicit Episode
   wrapper. Do not create a no-op Episode Task just to force a tree shape.
4. Read each Agent's `inputs`, `outputs` and optional `reviewers` contract
   from its frontmatter. Feed verified upstream artifact versions/paths to
   downstream Tasks. Preserve immutable source provenance and output hashes.
5. In the **first successful Episode Plan**, create one durable Task for
   **every normal Stage node** in the current `graph.mmd`. Submit the full
   Task DAG together, even when upstream Stage artifacts do not exist yet.
   `dependencies` keep downstream Tasks waiting until prerequisites succeed.
   Do not wait for Visioner to complete before creating Director, Editor,
   Producer or Final QA. Give downstream Task inputs the expected upstream
   artifact paths and contracts; each Agent verifies the actual current
   accepted versions when it runs. Never fabricate an upstream artifact,
   accepted result or immutable hash at planning time.
6. If an initial Plan partially created normal Stage Tasks, later Plan rounds
   add only the missing Stage Tasks, preserving existing task IDs and evidence.
   Later Plan rounds can also add independent exceptional work and revisions,
   without rewriting completed Task history or limiting dynamic Task count.
   This is **Planner policy**, not a separate Graph-to-Plan validator.
   Relay `plan apply` remains authoritative for generic Task/DAG/lifecycle
   constraints.

### Mandatory domain handoffs

- Visioner reuses existing Markcut `input/media/metadata.json` and only
  infers missing understanding. Output: `vision-evidence.json`.
- Director uses Visioner evidence, approved footage and optional SHA-verified
  Personal Tour references. It owns shot selection, Hook, story/payoff,
  contextual research and Shotcraft recipe intent. Outputs:
  `story.md`, `shot-selection.json`, `visual-brief.md`, `post.md`.
- Editor consumes Director's accepted decisions, refines exact in/out,
  rhythm, captions and treatment. Output: `edit-decision-list.json`.
- Producer consumes Director + Editor outputs, writes canonical `video.md`,
  sources approved audio, builds/render-checks the preview, then calls
  `agents-relay review run --prompt-file <run>/reviews/review-request.md --agents video-director,market --project-path <vlog-root> --output <run>/reviews/review.json`.
  The generic Outcome Reviewer is implicit. Repair and re-review until
  current preview PASS; specialist review is not a separate Stage Task.
- Final QA independently observes playback, sound, captions, source-truth,
  privacy and private archive receipt. Publication requires separate
  owner authorization.

For JSON outputs with a declared schema, the owning Agent explicitly calls
`agents-relay artifact validate --artifact PATH --schema PATH`. The
read-only Action does not automatically block Task completion; the Agent
must repair failures before reporting accepted output. Other media/rights/QA
checks remain domain-specific.

### Revisions and reviews

Producer-local Review/Fix stays within Producer. A final Job reviewer is a
**parentless Relay Task**, bound to the immutable current Job result. If it
returns `CHANGE_REQUIRED`, analyze the findings against Graph dependencies
and actual artifact I/O versions. Create only impacted revision Tasks, reuse
the original Stage Agent, attach each to the original owning Task when
appropriate, and chain actual revised handoffs. Never require revisions to
match the original stage-only DAG or let an arbitrary revision worker rewrite
all outputs. Re-review the current complete result after fixes.

Optional Visioner source Human Review needs owner input only for genuine
missing critical evidence. Do not fake human approval or launch a synthetic
human-agent Task. Archive privately by default. Follow Relay's independent
completion, failure, recovery and Final Review authority.
