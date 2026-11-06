# Vlog Episode Stages — reusable acceptance contract

Stage gates, artifacts and reviews. [graph.mmd](../graph.mmd) is the only normal-stage DAG;
watcher/ingress, clarification, independent Relay Final Review and
publishing are not Graph nodes. `INPUT_NEEDED` source input prevents Episode Tasks.
Visioner observations and owner testimony remain separate from explicitly fictionalized personal storytelling.

## Private render-only verification (explicit test exception)

Only for a Run that contains `review-mode.json` with `schemaVersion: 1`,
`mode: private-render-test`, `reviewStatus: UNREVIEWED`, and
`publicationAllowed: false` (created through authorized `neo project run
--no-review`), skip **both** the owner Preview and the specialist review.
This exception exists solely to test whether the Vlog pipeline produces a
complete playable private MP4. Producer must still compile and render a real
video, save `reviews/review.json` with `status: NOT_RUN`, `humanReview:
NOT_RUN`, `specialistReview: NOT_RUN`, and `publicationAllowed: false`. Final QA
must inspect actual playback, frame/audio quality and write `qa.md` marked
`UNREVIEWED` plus a private archive receipt with `publicationAllowed: false`.
The run is **not approved** and cannot be published. Never create fake PASS
receipts or call Preview, APNs, Relay specialist review, or human decision for
this exact test mode. All other run modes retain the standard gates below.

## Stage-local human interaction

Human review is not a Graph node. Visioner, Director and Editor may request optional clarification, separating owner testimony from footage. A temporary Markcut source preview is guidance, not Producer approval.
Except for the explicit private render-only test above, Producer must obtain **interactive owner approval of the latest canonical
`video.md`** in the same ChatGPT Worker; on a change request, revise, preview
again and store the current revision ID/hash and decision. If UI is unavailable, report a blocker, never infer approval. Final QA checks evidence. Preview approval is not publishing consent.

## Vlog Visioner evidence

Visioner starts the Graph. Reuse Markcut `input/media/metadata.json`, STT, VTT, timecodes and existing `perception.desc`; prefer the DeepSeek `--itt` / `--vtt` templates when needed. On failure, use another configured CLI template. Never invent another vision pipeline or early-cut MP4. Build the existing index with `node scripts/index-markcut-vision.mjs <run>`. Keep `vision-evidence.json`, segment index and interpretation separate; neither is approval. No GPS is a valid no-op.

| Stage | Owner | Accepted input / gate | Durable output under `runs/<episode>/` | Provenance and acceptance evidence | Hold or fail condition |
| --- | --- | --- | --- | --- | --- |
| **Source** | watcher/owner approval with shared phone-media | Manifest identifies source assets and episode window | `source-manifest.json` with source IDs, original location, selected in/out ranges and timestamp provenance | Recorded media references and original timecodes | `INPUT_NEEDED`, unsuitable media, ambiguous episode window: no Episode Task starts |
| **Visioner** | vlog-visioner + Markcut Vision | Source manifest and local readable media | `vision-evidence.json` with timecoded visual/audio understanding, metadata and explicit gaps | Every assertion cites source media/time range or metadata origin; separate observation from inference | Unreadable material or critical uncertainty holds affected work; never fabricate |
| **Human source review (optional)** | owner through interactive Worker when available | Optional precise questions | `vision-human-review.json` with status, questions, answers and provenance | Distinguish owner testimony from observed evidence | Do not invent missing answers; optional decline may proceed only without unsupported claims |
| **Research (conditional)** | vlog-director with shared phone-media/EXIF and location research capabilities | Visioner manifest and story-relevant research questions; GPS metadata is optional | `route-evidence.json` or explicit `not-applicable` status, `location-enrichment.json` if relevant, research notes | Each fact links back to source ID, original EXIF/QuickTime metadata or attributable external source; capture timezone uncertainty, original precision and calculated-vs-observed distinction | Missing GPS is a successful no-op, not a pipeline failure; invalid and outlier GPS excluded; unavailable evidence only affects the enrichment |
| **Story / shot selection** | vlog-director | Visioner evidence, source manifest, optional research and authentic story beats | `personal-story.md`, `personal-story.json`, then `story.md`, `post.md`, `shot-selection.json`, `visual-brief.md`; optional [audience familiarity review](story-familiarity-review.md) | A complete first-person human goal/setback/actions/outcome precedes shots; JSON story-beat IDs bind selected shots, original footage references real source IDs; invented personal incidents explicitly classified | Scenic-only descriptions, missing human arc, fabricated on-camera acts or undocumented factual speech: revise within Director |
| **Editing** | vlog-editor | Director personal story, shot selection and visual brief | `edit-decision-list.json` with source in/out, `sourceDuration`, `playbackSpeed`, `timelineDuration`, and still-motion treatment | Each cut preserves `personal_story_id` and `story_beat_id` plus selected source ID, interval and reason | Unapproved scene/story replacement or missing source: return to Director, never invent |
| **Production** | vlog-producer with shared video-director, audio-sourcing and Markcut | Director personal story ID and source-linked shot plan (goal, outcome, evidence, ordered scene IDs), shot selection, Editor decision list and visual brief; original sound and template-selected BGM | `episode-input.json` with actual `story.progression[].delivery` (audible hook/payoff; no long scenic-only middle), `music-plan.json`, `video.md`, `execution/`, `assets/`, `output/`, captions | Source references per scene, template-song identity, audible mix/ducking decisions, Chinese default text, visual/source-truth checks; GPS map inserted using original location evidence | Missing actual template-selected BGM asset, absent original media, unsupported geographic claim or unresolved Markcut output: hold; never replace source footage with synthetic demonstration |
| **Immutable Preview Review** | owner via current ChatGPT Producer Worker and Markcut Preview | Canonical compiled draft, exact revision/content hash, Markcut preview | Revision-specific preview and review record under `reviews/` | Owner decision bound to immutable revision and source/use scope; changed drafts invalidate approval | Not reviewed or changes required: Producer holds; fix and re-preview in same Worker, no extra Relay Task |
| **Video Director + Market reviews** | Producer's `agents-relay review run` Action calls implicit generic Reviewer and shared video-director/market; Producer stores results | Exact preview revision and draft | `reviews/review-request.md`, `reviews/review.json` | Explicit `PASS` from both, validating story/pace/source truth, sound mix, captions, platform/audience fit | Any `CHANGE_REQUIRED` or revision mismatch prevents final render |
| **Technical QA / archive** | vlog-final-qa independently inspects the Producer render; Relay preserves receipt | Approved draft, required review PASS and actual rendered `output/` | `qa.md`, immutable archive receipt | Actually observe final pixels, source media, route tiles/camera when used, Play/Seek, sound/BGM and WebVTT; verify exact delivered video bytes | Compilation/local HTTP alone does not pass hosted preview. Verify real hosted-preview playback when required; no fake acceptance. Archive is default without publication authorization |
| **Publish Authorization (optional)** | owner for authorization; shared post-agent for approved delivery | Accepted immutable output and explicit human authorization for platform/account/scope, including privacy and rights | `publish/` authorization reference; if authorized, shared post-agent receipt and platform verification | Record who approved which version, where and when, then post-agent platform-side status; retain archived copy | Without explicit authorization, **archive only**. No spending or posting by inference; missing receipt is not successful publication |

## Optional location semantics

No usable GPS -> research no-op -> full normal Vlog. Partial GPS -> only source-linked stops, no invented movement. Multiple trustworthy samples allow an optional story-relevant map; filter outliers and gaps. Keep original GPS with source provenance; publication approval must cover any precise or sensitive location displayed. Directions and cinematic camera paths are **not recorded movement**. Synthetic examples are never source footage.

## Immutable revision dependency key and change requests

Every review records `revisionId`, `contentHash` and input dependency hashes
(source, story, selection, EDL, brief, music, video and captions). Changes to
any referenced input invalidate the prior PASS and owner approval; rebuild a
new revision and re-review. Producer handles interactive `changes_requested`
inside the same Worker; independent Relay Final Review corrections use Relay
Tasks, not Graph back edges. Parser or simulated QA is never human approval.

See [three fully synthetic worked examples](synthetic-stage-examples.md).

## Terminal Stage contract and self-heal gate

Agents run `node <vlog-root>/scripts/validate-stage.mjs <stage> <run>` before success. Delegates schema checks to Relay and verifies contract files and upstream references. On FAIL, repair locally and rerun; emit `task.completed` only after PASS, otherwise `task.failed` with diagnostics. No repeated source analysis or SHA-256 comparison. TTS and BGM mixing happen in Production, after Editor timing. Initial preflight checks template-declared URLs/files only. License and authorization audits are outside the creative DAG.

## Story-paced media-treatment contract

Director's complete first-person narrative sets beat timing. Editor maps original intervals to `timelineDuration` with `playbackSpeed` or still-motion. Producer derives source-linked media. Reviewers verify goal/setback/action/payoff and visible motion. See [story-paced media](story-first-route-sound.md#story-paced-media-coverage-source-evidence-vs-screen-time).
