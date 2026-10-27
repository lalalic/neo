# One Episode Task — reusable stage contract

This is a design contract, **not** an episode, scheduler or authorization. It continues [PR #127](https://github.com/lalalic/neo/pull/127) and [PR #129](https://github.com/lalalic/neo/pull/129). Source approval is a prerequisite to *creating* a real Episode Task. The 2026-10-11 pilot manifest is `INPUT_NEEDED`, so no episode may be invented for it.

**Graph authority:** [graph.mmd](../graph.mmd) is the sole canonical normal-stage DAG. Visioner runs first within an Episode (shared visioner/Markcut Vision) to write source-linked visual/audio evidence, available metadata and a missing-information report. Immediately afterward, optional human source review can answer material questions before Director. Default is skip if not requested and evidence is sufficient. Never invent answers, confuse owner testimony with observed video, or bypass source-use permission. Watcher/ingress is outside the Episode Graph.

## Visioner capability contract

The Vlog Visioner is a normal Task worker using the shared Neo
`<workspace>/neo/agents/visioner.agent.md` contract and this Vlog stage contract. It must load the discovered
`markcut` skill and use `npx @lalalic/markcut vision <input/media>`
for any missing source understanding. Its first input is the existing
`input/media/metadata.json`; `perception.desc` and video segment evidence
are reusable results, not a request for fresh inference.

Markcut owns ITT (image-to-text), VTT (video-to-text), STT, model selection,
frame sampling and cache. A direct VTT backend is optional; the Markcut
frame-sampling/ITT path remains valid. Backend configuration should favor a
supported remote vision path on resource-constrained Neo Masters, with local
inference used only when resources support it or offline operation is required.
The Vlog contract does not choose a provider/model or implement fallback
outside Markcut.

The two distinct durable outputs are Markcut's
`input/media/metadata.json` (per-media understanding) and Vlog's
`vision-evidence.json` (source-grounded interpretation and uncertainty for
Director). Keep optional transcript/caption `.vtt` files under Markcut's
source-relative paths. Do not confuse subtitle VTT with video-to-text
inference. Watcher owns media integrity before the Episode Job.

The old `vlog-editor -> vlog-producer` Agent Graph is historical; only `graph.mmd` defines current normal stages. Planner must preserve Visioner-first dependencies and all required review gates when selecting visible agents and compiling the executable Task graph.

```text
owner-approved source -> Visioner -> Human Review? -> Director (Research? + Story + Shot Selection) -> Editor -> Production -> immutable Preview Review
                                   -> Video Director + Market reviews -> technical QA
                                   -> explicit Publish Authorization? -> publish with receipt
                                                                  \-> archive (default)
```

Normal stages are durable Tasks when their independent outputs require a lifecycle. Planner reads `graph.mmd` and resolves visible Agents; the Episode Job owns the outcome. Task parentage expresses semantic ownership, while dependencies express execution order. Final Review is parentless and is not a Graph stage. Relay owns retries, review revisions, escalation and recovery; do not add feedback edges or a project scheduler.

| Stage | Owner | Accepted input / gate | Durable output under `runs/<episode>/` | Provenance and acceptance evidence | Hold or fail condition |
| --- | --- | --- | --- | --- | --- |
| **Source** | watcher/owner approval with shared phone-media | Owner confirms episode window and grants use permission per authentic asset | `source-manifest.json` with source IDs, hashes, original location, rights/use status, selected in/out ranges and timestamp provenance | Checksum and permission reference per item; selected real images/video and original audio | `INPUT_NEEDED`, missing rights, unsuitable media, ambiguous episode window: no Episode Task starts |
| **Visioner** | shared visioner + Markcut Vision | Owner-approved manifest and local readable media | `vision-evidence.json` with timecoded visual/audio understanding, metadata and explicit gaps | Every assertion cites source media/time range or metadata origin; separate observation from inference | Unreadable material or critical uncertainty holds affected work; never fabricate |
| **Human source review (optional)** | owner through Relay approval/escalation | Visioner findings and precise questions; default not requested | `vision-human-review.json` with status, questions, answers and provenance | Distinguish owner testimony from directly observed evidence | Required clarification waits durably; optional decline may proceed only without unsupported claims |
| **Research (conditional)** | vlog-director with shared phone-media/EXIF and location research capabilities | Approved manifest and story-relevant research questions; GPS metadata is optional | `route-evidence.json` or explicit `not-applicable` status, `location-enrichment.json` if relevant, research notes | Each fact links back to source ID, original EXIF/QuickTime metadata or attributable external source; capture timezone uncertainty, privacy and calculated-vs-observed distinction | Missing GPS is a successful no-op, not a pipeline failure; invalid/outlier/private GPS excluded; external permission holds only the affected enrichment |
| **Story / shot selection** | vlog-director | Visioner evidence, source manifest, optional research and authentic story beats | `story.md`, `post.md`, `shot-selection.json`, `visual-brief.md`; optional [audience familiarity review](story-familiarity-review.md) | Hook/development/payoff references exact source IDs, shot ranges, original dialogue/ambient audio; generated context explicitly identified | Unsupported visits, invented movement/scene, unusable story evidence or invented dialogue: revise through Relay |
| **Editing** | vlog-editor | Director shot selection and visual brief | `edit-decision-list.json` with exact source in/out and treatment | Each cut references the selected source ID, candidate interval and reason for adjustment | Unapproved scene/story replacement or missing source: return to Director, never invent |
| **Production** | vlog-producer with shared video-director, audio-sourcing and Markcut | Director story, shot selection, Editor decision list and visual brief with approved media; original sound and licensed/authorized BGM plan | `music-plan.json`, `video.md`, `execution/`, `assets/`, WebVTT captions | Source references per scene, licenses and music clearance, audible mix/ducking decisions, Chinese default text, visual/source-truth checks; optional map insert separately redacted and authorized | Missing BGM clearance, absent original media, unavailable rights, unapproved private location or unresolved Markcut output: hold; never replace source footage with synthetic demonstration |
| **Immutable Preview Review** | human reviewer through Relay revision-bound review | Canonical compiled draft, exact revision/content hash, human-accessible Markcut preview | Revision-specific preview and review record under `reviews/` | Reviewer decision bound to immutable revision and source/use scope; any changed draft invalidates earlier approval | Not reviewed or changes required: hold. Corrections create a new Relay task/review lifecycle, not an agentGraph back-edge |
| **Video Director + Market reviews** | Producer's `agents-relay review run` Action calls implicit generic Reviewer and shared video-director/market; Producer stores results | Exact preview revision and draft | `reviews/review-request.md`, `reviews/review.json` | Explicit `PASS` from both, validating story/pace/source truth, sound mix, captions, platform/audience fit | Any `CHANGE_REQUIRED` or revision mismatch prevents final render |
| **Technical QA / archive** | vlog-producer using shared render/QA; Relay preserves receipt | Dual PASS, approved draft and resolved Markcut backend | `output/` render, `qa.md`, immutable archive receipt | Actually observe final pixels, source media, route tiles/camera when used, Play/Seek, sound/BGM and WebVTT; verify exact delivered video bytes | Compilation/local HTTP alone does not pass hosted preview. Job 474 hosted iframe bootstrap remains a separate unresolved gate; no fake acceptance. Archive is default without publication authorization |
| **Publish Authorization (optional)** | owner for authorization; shared post-agent for approved delivery | Accepted immutable output and explicit human authorization for platform/account/scope, including privacy and rights | `publish/` authorization reference; if authorized, shared post-agent receipt and platform verification | Record who approved which version, where and when, then post-agent platform-side status; retain archived copy | Without explicit authorization, **archive only**. No spending or posting by inference; missing receipt is not successful publication |

## Optional location semantics

No usable GPS -> research no-op -> full normal Vlog. Partial GPS -> only source-linked reliable stops, no guessed stops for other footage. Two or more trustworthy samples may permit a brief optional map/context scene **only** if editorially useful and separately authorized for disclosure. Filter ambiguous clocks, outliers, large gaps, inaccurate and sensitive points. Redact location; never upload raw GPS to a public mount. Road directions and cinematic camera paths are inferred visualizations, **never recorded movement**; do not invent presence, transport mode or visited places. Samples/tests are labelled synthetic and never substituted for episode footage.

The human preview is revision-bound, both required reviews precede render, and final technical QA is observed rather than inferred. Never publicly publish without explicit authorization.

## Immutable revision dependency key and change requests

Every review records `revisionId`, cryptographic `contentHash`, and dependency identities (`sourceMediaHashes`, `sourceManifestHash`, `storyHash`, `shotSelectionHash`, `editDecisionListHash`, `visualBriefHash`, `productionVideoHash`, `musicPlanHash`, `captionHash`). A content or dependency hash change invalidates *all* earlier simulated or real review outcomes; a new immutable revision and a separate re-review are required. `changes_requested` returns to Relay durable lifecycle, never an agentGraph back edge. Technical QA must be observable; simulated QA entries in synthetic examples are **NOT_RUN**.

See [three fully synthetic worked examples](synthetic-stage-examples.md).
