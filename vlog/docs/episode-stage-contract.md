# Vlog Episode Stages — reusable acceptance contract

Stage gates, artifacts and reviews. [graph.mmd](../graph.mmd) is the only normal-stage DAG;
watcher/ingress, clarification, independent Relay Final Review and
publishing are not Graph nodes. `INPUT_NEEDED` source input prevents Episode Tasks.
Visioner observations and owner testimony must remain distinguishable.

## Stage-local human interaction

Human review is not a Graph node or a Relay terminal event.
Visioner, Director and Editor may request optional clarification,
separating owner testimony from footage. A temporary Markcut source preview
is guidance, not Producer approval.
Producer must obtain **interactive owner approval of the latest canonical
`video.md`** in the same ChatGPT Worker; on a change request, revise, preview
again and store the current revision ID/hash and decision. If the UI is
unavailable or the Worker times out, report a blocker; never infer approval.
Final QA checks that evidence. Preview approval is not publishing consent.

## Shared Visioner evidence

Visioner is the first Graph Stage. Use the shared Neo Visioner Agent and
discovered Markcut Skill. Reuse `input/media/metadata.json`, `perception.desc`,
source VTT and hashes. For gaps, **prefer the DeepSeek `--itt` / `--vtt`
CLI templates defined in the shared Agent**, without provider-specific
Markcut flags. Preserve Markcut STT and `--agent` segmentation; pass
`config/hey-neo-vision-context.md` and episode context via `--instruct`.
If DeepSeek fails, report why; only use another authorized CLI template.
Never invent a parallel vision pipeline or early-cut MP4.

Index the real metadata with
`node scripts/index-markcut-vision.mjs <dated-run>` from Vlog root.
Keep `input/media/metadata.json` (per-media observations),
`vision-segment-index.json` (verified index) and separate
`vision-evidence.json` (Visioner interpretation and uncertainty).
Indexes do not grant media-use permission. Planner takes roles from
the resolved Graph, never inventing them.

| Stage | Owner | Accepted input / gate | Durable output under `runs/<episode>/` | Provenance and acceptance evidence | Hold or fail condition |
| --- | --- | --- | --- | --- | --- |
| **Source** | watcher/owner approval with shared phone-media | Owner confirms episode window and grants use permission per authentic asset | `source-manifest.json` with source IDs, hashes, original location, rights/use status, selected in/out ranges and timestamp provenance | Checksum and permission reference per item; selected real images/video and original audio | `INPUT_NEEDED`, missing rights, unsuitable media, ambiguous episode window: no Episode Task starts |
| **Visioner** | shared visioner + Markcut Vision | Owner-approved manifest and local readable media | `vision-evidence.json` with timecoded visual/audio understanding, metadata and explicit gaps | Every assertion cites source media/time range or metadata origin; separate observation from inference | Unreadable material or critical uncertainty holds affected work; never fabricate |
| **Human source review (optional)** | owner through interactive Worker when available | Visioner findings and precise questions; default not requested | `vision-human-review.json` with status, questions, answers and provenance | Distinguish owner testimony from observed evidence | Do not invent missing answers; optional decline may proceed only without unsupported claims |
| **Research (conditional)** | vlog-director with shared phone-media/EXIF and location research capabilities | Approved manifest and story-relevant research questions; GPS metadata is optional | `route-evidence.json` or explicit `not-applicable` status, `location-enrichment.json` if relevant, research notes | Each fact links back to source ID, original EXIF/QuickTime metadata or attributable external source; capture timezone uncertainty, original precision and calculated-vs-observed distinction | Missing GPS is a successful no-op, not a pipeline failure; invalid and outlier GPS excluded; external permission holds only the affected enrichment |
| **Story / shot selection** | vlog-director | Visioner evidence, source manifest, optional research and authentic story beats | `story.md`, `post.md`, `shot-selection.json`, `visual-brief.md`; optional [audience familiarity review](story-familiarity-review.md) | Hook/development/payoff references exact source IDs, shot ranges, original dialogue/ambient audio; generated context explicitly identified | Unsupported visits, invented movement/scene, unusable story evidence or invented dialogue: revise through Relay |
| **Editing** | vlog-editor | Director shot selection and visual brief | `edit-decision-list.json` with exact source in/out and treatment | Each cut references the selected source ID, candidate interval and reason for adjustment | Unapproved scene/story replacement or missing source: return to Director, never invent |
| **Production** | vlog-producer with shared video-director, audio-sourcing and Markcut | Director source-linked story plan (goal, outcome, evidence and ordered scene IDs), shot selection, Editor decision list and visual brief; original sound and template-selected BGM | `episode-input.json` with actual `story.progression[].delivery` (audible hook/payoff; no long scenic-only middle), `music-plan.json`, `video.md`, `execution/`, `assets/`, `output/`, captions | Source references per scene, template-song identity and music hashes, audible mix/ducking decisions, Chinese default text, visual/source-truth checks; GPS map inserted using authorized original location evidence | Missing actual template-selected BGM asset, absent original media, unavailable rights, unsupported geographic claim or unresolved Markcut output: hold; never replace source footage with synthetic demonstration |
| **Immutable Preview Review** | owner via current ChatGPT Producer Worker and Markcut Preview | Canonical compiled draft, exact revision/content hash, human-accessible Markcut preview | Revision-specific preview and review record under `reviews/` | Owner decision bound to immutable revision and source/use scope; any changed draft invalidates earlier approval | Not reviewed or changes required: Producer holds; fix and re-preview in same Worker, no extra Relay Task |
| **Video Director + Market reviews** | Producer's `agents-relay review run` Action calls implicit generic Reviewer and shared video-director/market; Producer stores results | Exact preview revision and draft | `reviews/review-request.md`, `reviews/review.json` | Explicit `PASS` from both, validating story/pace/source truth, sound mix, captions, platform/audience fit | Any `CHANGE_REQUIRED` or revision mismatch prevents final render |
| **Technical QA / archive** | vlog-final-qa independently inspects the Producer render; Relay preserves receipt | Approved draft, required review PASS and actual rendered `output/` | `qa.md`, immutable archive receipt | Actually observe final pixels, source media, route tiles/camera when used, Play/Seek, sound/BGM and WebVTT; verify exact delivered video bytes | Compilation/local HTTP alone does not pass hosted preview. Verify real hosted-preview playback when required; no fake acceptance. Archive is default without publication authorization |
| **Publish Authorization (optional)** | owner for authorization; shared post-agent for approved delivery | Accepted immutable output and explicit human authorization for platform/account/scope, including privacy and rights | `publish/` authorization reference; if authorized, shared post-agent receipt and platform verification | Record who approved which version, where and when, then post-agent platform-side status; retain archived copy | Without explicit authorization, **archive only**. No spending or posting by inference; missing receipt is not successful publication |

## Optional location semantics

No usable GPS -> research no-op -> full normal Vlog. Partial GPS -> only source-linked stops, no invented movement. Two or more trustworthy samples may permit a brief optional map/context scene **only** if editorially useful and source-authorized. Filter ambiguous clocks, outliers, large gaps and inaccurate points. Keep original GPS with source provenance; publication approval must cover any precise or sensitive location displayed. Road directions and cinematic camera paths are inferred visualizations, **never recorded movement**; do not invent presence, transport mode or visited places. Samples/tests are labelled synthetic and never substituted for episode footage.

## Immutable revision dependency key and change requests

Every review records `revisionId`, `contentHash` and input dependency hashes
(source, story, selection, EDL, brief, music, video and captions). Changes to
any referenced input invalidate the prior PASS and owner approval; rebuild a
new revision and re-review. Producer handles interactive `changes_requested`
inside the same Worker; independent Relay Final Review corrections use Relay
Tasks, not Graph back edges. Parser or simulated QA is never human approval.

See [three fully synthetic worked examples](synthetic-stage-examples.md).
