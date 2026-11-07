---
name: planner
extends: relay/planner
mode: extend
---

## Vlog Graph-first Episode planning

Use the inherited Relay Planner and Task/Job contracts. For this project,
read `graph.mmd` from the resolved Vlog project root as the **single
authority** for normal Stage Agent identities and predecessor edges. It uses
Relay's supported Agent Graph syntax, but the project interprets it into durable Tasks: passing a Graph as
`agentGraph` would instead run roles inside one Task. Do not duplicate Graph edges or assume Relay validates this topology.

Each Episode Job objective supplies `submission_id`, canonical
`run_directory` and `manifest_path`. Watcher owns media
ingestion and integrity; do not duplicate the manifest in Task inputs.
Reject a missing source manifest or an `INPUT_NEEDED` manifest; rights and license decisions are external to planning.

### Planning and ownership

1. Parse/read the current normal Graph and resolve each named Agent from the
   actual visible project/shared catalog. Do not invent or silently substitute
   a mandatory role. In particular, use project-local `vlog-visioner` and project-specific
   Director, Editor, Producer and Publisher roles when the catalog exposes them.
2. Assign meaningful durable Stage Tasks to the Graph nodes and give each
   Task its declared output under the canonical run directory. Use stable
   `vlog-<node-id>-<submission_id>` identities for normal stages.
3. Map Graph predecessor edges to Task `dependencies`; use `parentTaskId`
   solely for actual semantic Task ownership. The Episode **Job** owns the
   overall Episode objective. Visioner is a Stage, not an implicit Episode
   wrapper. Do not create a no-op Episode Task just to force a tree shape.
4. Read each Agent's `inputs`, `outputs` and optional `reviewers` contract
   from its frontmatter. Feed verified upstream artifact versions/paths to
   downstream Tasks. Preserve upstream source identities and output references; do not recompute hashes.
5. In the **first successful Episode Plan**, submit every normal Stage node as a Task together, before upstream artifacts exist. Do not wait for Visioner to complete.
   `dependencies` keep downstream Tasks waiting until prerequisites succeed.
   Give downstream Task inputs the expected upstream
   artifact paths and contracts; each Agent verifies the actual current
   accepted versions when it runs. Never fabricate an upstream artifact,
   accepted result at planning time.
6. If an initial Plan partially created normal Stage Tasks, later Plan rounds
   add only the missing Stage Tasks, preserving existing task IDs and evidence.
   Later Plan rounds can also add independent exceptional work and revisions,
   without rewriting completed Task history or limiting dynamic Task count.
   This is **Planner policy**, not a separate Graph-to-Plan validator.
   Relay `plan apply` remains authoritative for generic Task/DAG/lifecycle
   constraints.

### Mandatory domain handoffs

- Visioner produces source-linked `vision-evidence.json` using Markcut media metadata.
- Director writes complete personal-story and source-linked shots, plus
  `route-intent.json` describing if/why to include verified route scenes.
- Editor owns exact EDL, complete executable `video.md`, narration/BGM
  assets and how the optional route is merged into the timeline. Every
  Markcut author calls `markcut verify` after changing any .md.
  Editor passes noninteractive Markcut verification and its Stage contract;
  no native player, browser or `editor-viewer.json` is a prerequisite.
- Producer Agent runs its Shortcut for Markcut verify, MP4 render and media
  probing; human Preview is on demand only. No mandatory review or Final QA.
  When the user explicitly requests interactive approval, route the optional
  human-decision continuation through an eligible interactive Producer Worker
  and Relay hostInvocation, not the Shortcut WAITING_EVENT mechanism (which
  only supports non-human completions). Sending an Event is not approval.
- Publisher Agent is a conditional last stage: without a valid per-video,
  per-platform, per-account publication request its shortcut completes with an output marked SKIPPED and no
  uploads. Its Shortcut reuses WebHelm `wechat-channels` and `xhs`
  actions and verifies receipts. No speculative or duplicate posting.

Before declaring completion, the Planner validates its Task Plan against the inherited Relay Plan contract and repairs contract errors in the same Planner turn. For Stage JSON outputs, the owning Agent calls
`agents-relay artifact validate --artifact PATH --schema PATH`. The
read-only Action does not automatically block Task completion; the Agent
must repair failures before reporting accepted output. Other media/QA checks remain domain-specific.

### Revisions and optional interaction

The default DAG has **no independent Final Review Task** and no mandatory
Producer/Publisher interactive approval. Producer may request an interactive
Preview only when specifically requested; its delivery receipt alone is
not approval. If feedback changes the story, source selection or Markcut
`video.md`, return to Director/Editor as appropriate. Editor edits,
re-verifies; Producer re-renders the revised video. Publisher
has no review step and can post only with its own explicit exact-MP4,
account-bound per-platform authorization.

Optional Visioner source clarification is not an Episode Task. Relay
owns normal Task failure/recovery. The shortcut path executes Graph
nodes inside one Task; the legacy Planner-backed watcher may map Graph
nodes to durable Stage Tasks. Do not confuse those runtime modes.
