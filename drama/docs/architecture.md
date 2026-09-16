# Drama architecture

## Purpose

Drama separates reusable creative assets, orchestration state, media generation, quality evidence, rendering, and external delivery adapters. A human- or agent-authored narrative layer describes what exists and what should happen. Specialist agents make domain decisions. Providers execute bounded generation. Markcut owns deterministic timeline and rendering behavior. Independent reviewers decide whether observable artifacts satisfy the next gate.

The detailed orchestration contract and diagrams are in `docs/workflow.md`. Machine-readable routing lives in `config/workflow.json`.

## Layers

```text
durable creative assets
  -> workflow orchestration + specialist routing
  -> provider execution
  -> artifact provenance + deterministic validation
  -> independent QA evidence
  -> state transition through APPROVED

external delivery adapter (separate job, optional)
  -> destination transport + receipt verification
```

These layers must remain distinct. In particular, a provider response is not a QA decision, an Event Bus message is not durable state, and a send command is not proof of delivery.

## Stage graph

```text
series/character/location assets
  -> story/episode design
  -> prepare (validate contracts)
  -> concept (Agnes text-to-image)
  -> dialogue (local mlx-audio)
  -> shots (Agnes image-to-video/text-to-video)
  -> continuity evidence
  -> assemble resolved storyboard
  -> Markcut verify
  -> Markcut render
  -> deterministic technical QA
  -> visual/narrative evidence review
  -> approval

After `APPROVED`, the Drama core workflow is complete. Optional delivery is a separate adapter workflow that consumes an approved artifact identity.
```

Each generated artifact stage is identified in `runs/<run-id>/generated/manifest.json` and may be retried independently. Successful media outputs and their sidecars cause later invocations to skip work unless `--force` is deliberately used. Workflow state for an orchestrated run belongs under `runs/<run_id>/`; repairs remain in the same run.

## Routing architecture

The top-level XChat assistant is the workflow owner. It chooses a specialist role according to `config/workflow.json`, then uses `model-router` when a new delegated model worker is needed. Agent role and model identity are intentionally separate.

Typical responsibilities:

| Stage | Domain owner | Execution | Independent review |
| --- | --- | --- | --- |
| story | `narrative-designer` | durable text assets | `narratologist` |
| concept | `image-prompt-engineer` | Agnes image | `brand-guardian` |
| dialogue | `narrative-designer` | local `mlx-audio` | `short-video-editing-coach` |
| shot | `image-prompt-engineer` | Agnes video | `evidence-collector` |
| assembly/edit | `short-video-editing-coach` | Markcut | `evidence-collector` |
| episode QA | `reality-checker` | deterministic checks + local vision evidence | evidence must be externally observable |
| external delivery adapter | `studio-operations` | channel adapter outside Drama core | `evidence-collector` destination verification |

The installed agent definitions live under `~/.codex/agents`. `./drama.sh workflow` reports whether every configured specialist is available.

## State architecture

Three stores answer different questions:

1. `runs/<run_id>/run.json` and episode state files — **what is true now** for a production run.
2. Event Bus — **what is happening now** while workers execute.
3. `runs/<run-id>/generated/manifest.json` and artifact sidecars — **what was produced**, by which provider, from which inputs, and with which technical evidence.

Do not collapse them. A future orchestration layer may automate run-state mutation, but every XChat session must already follow the separation contract.

## Asset contracts

### Series: `runs/<run-id>/story/series.json`

Title, language, logline, episodes, canonical output size, and fps. Episode IDs are stable and extensible. Valid IDs use the form `ep01`, `ep02`, `ep03`, `ep04`, and so on. The validator no longer assumes exactly three episodes.

### Character: `runs/<run-id>/characters/<id>/character.yaml`

Stable identity, appearance, personality, audio direction, continuity rules, canonical image prompt, and reference note. Canonical concept image path is run-scoped, for example `runs/<run-id>/generated/images/taotao-concept.png`.

### Locations: `runs/<run-id>/locations/<id>/location.yaml`

Visual continuity constraints, lighting, camera feeling, and prompts. Location prompts constrain shots; they do not replace character identity.

### Episode: `runs/<run-id>/episodes/<id>/script.json`

Ordered lines containing `id`, `speaker`, `text`, `voice_direction`, and optional target shot.

### Shot plan: `runs/<run-id>/episodes/<id>/shots.json`

Ordered shots containing `id`, `duration_sec`, camera/subject/action/location, image/video prompts, and generated asset IDs.

A shot may additionally declare:

```json
{
  "id": "shot02",
  "continuity_from": "shot01"
}
```

`continuity_from` must reference an earlier shot in the same episode. During generation, Drama extracts the prior shot's end frame under `runs/<run-id>/generated/continuity/` and uses it as the Agnes image-to-video input. This creates an explicit continuity chain instead of relying only on repeated prompt text.

### Markcut storyboard: `runs/<run-id>/episodes/<id>/storyboard.md`

A `# video` document with 1080×1920, 24 fps canvas. Prompt-driven nodes support pre-generation planning; the resolved generated storyboard under `runs/<run-id>/generated/` references concrete video/audio files for render.

### Generated artifact sidecar

For each media file, a `.json` file beside it records provenance. New artifacts include at least:

```json
{
  "id": "...",
  "kind": "image|audio|video",
  "provider": "...",
  "status": "generated",
  "prompt": "...",
  "source_assets": [],
  "created_at": "...",
  "output": "...",
  "command_log": "...",
  "size_bytes": 123,
  "sha256": "..."
}
```

Video sidecars additionally include deterministic technical evidence from `ffprobe`, including measured duration and stream information. Sidecars preserve provenance and make outputs auditable. Command logs may contain prompts and public errors, never secrets.

## Success evidence

A successful command is only execution evidence. Every stage has a stronger business-level success condition in `config/workflow.json`.

Examples:

- Agnes video: output must exist, decode through `ffprobe`, have a positive duration, and receive a provenance sidecar.
- TTS: output must be a valid WAV, not merely a file with a `.wav` suffix.
- Markcut media render: output must decode and measured duration/size must be recorded before `render:<episode>` succeeds.
- QA: deterministic evidence plus independent artifact review; a model-generated `PASS` alone is insufficient.
- Delivery: exact artifact identity plus destination-side verification; transport invocation alone is insufficient.

## Provider boundaries

| Concern | Provider | Boundary |
| --- | --- | --- |
| TTS | local `mlx-audio` | Executed locally through `uvx --from mlx-audio`. |
| Image/video understanding | local `mlx-vlm` | Never send understanding jobs to Agnes. |
| Text-to-image and image-to-video | Agnes | Invoked by the installed `create-image-video` scripts. |
| Timeline compile/render | Markcut | `verify`, `preview`, or `render`; Drama never edits Markcut output internals. |
| Review delivery | explicit adapter, e.g. `wechat-bro` | Outside generation providers; requires destination verification. |

The Agnes scripts resolve `AGNES_API_KEY`, then `~/.pi/agent/auth.json`, then `~/.pi/agent/models.json`. Drama reports which source exists, not the key value.

## Event Bus boundary

Long-running or delegated production follows the global `events-bus` protocol. One top-level `job_id` represents a production run. Child tasks inherit it. The orchestrator subscribes before workers start and stays in the wait/render loop until a reconciled top-level terminal event.

Repairs such as dependency fixes, regenerated audio, rerenders, QA repairs, and delivery retries do not mint a replacement top-level job. They are child task/state transitions inside the original run.

## Artifact identity and delivery

Working render paths remain convenient and stable, such as `runs/<run-id>/generated/video/ep04-render.mp4`. A review/delivery package must use a unique identity that includes revision and content hash, for example:

```text
taotao-ep04-r001-a1b2c3d4.mp4
```

A delivery receipt should bind this identity to destination, revision, SHA-256, duration, timestamp, and source manifest version. This prevents duplicate-name ambiguity and makes retries idempotent and auditable.

Delivery to a review chat is external production logistics, not a Drama core stage and not social publication. It starts only after `APPROVED`, uses an explicit channel adapter, and records a separate receipt. For WeChat, MP4/video artifacts use `wechat-bro send-video`; `send-file` is reserved for non-video attachments. Social publication remains a separate explicitly authorized workflow.

## Failure and repair policy

- `prepare` failure blocks generation.
- Provider authentication failure blocks only the affected generation stage and records the public blocker.
- Invalid generated media fails before the stage can be marked succeeded.
- Markcut compile/render failure leaves accepted upstream artifacts untouched.
- QA failure enters `REPAIRING`, identifies the smallest failed stage, repairs it, then re-enters the failed gate.
- Delivery transport or verification failure does not roll back or mutate the Drama production state (`APPROVED`). The external delivery job remains failed/repairing until destination evidence exists.
- No silent provider substitution is allowed.
