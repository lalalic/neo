# Vlog Episode Stages — canonical acceptance

[graph.mmd](../graph.mmd) is the one normal DAG. These are private
`runs/<episode>/` artifacts, not independent review Jobs. No independent
Final QA or mandatory Final Review is required; no human preview is
required for an ordinary private MP4.

| Stage | Output | Acceptance |
| --- | --- | --- |
| Source | `source-manifest.json` | Owner-authorized real evidence; `INPUT_NEEDED` blocks |
| Visioner | `vision-evidence.json`, `vision-normalized-manifest.json` | Source-bound observations and optional `creator_intent_annotations[]` from Markcut semantic segments; source ID/time/hash, uncertain machine interpretation, no auto-applied edit (sparse samples are not an exhaustive action inventory) |
| Director | `personal-story.md/json`, `story.md`, `shot-selection.json`, `visual-brief.md`, `post.md`, `route-intent.json` | Complete human intent → exploration/development → real result; setbacks optional, source-linked route or omit |
| Editor | `edit-decision-list.json`, assets, `episode-input.json`, `music-plan.json`, `video.md` | Independent source-backed shot selection, sound and rhythm cut, private rough-cut render with real frame/audio inspection, final Markcut verify and Stage validation; no human gate |
| Producer | `output/video.mp4`, `production-receipt.json` | Verify again, render exact Editor revision, probe playable video **and audio**, Preview only on request |
| Publisher | `publish/<platform>-receipt.json` or SKIPPED | Separate explicit per-MP4, per-platform/account authorization and verified platform status |

## Route division

Director decides whether to include a geographical view and **describes
the route story** with real filmed source references and a desired
story beat. `route-intent.json` has `decision: include|omit`,
`reason`, and for inclusion `insertAfterStoryBeatId`, `narration`
and source-linked `observedStops`. An omitted route is a normal success.

Editor records the selected geography in `episode-input.geo` and authors
Markcut-native map/route scenes in `video.md` (or separate `route.md` when
necessary), choosing precise placement, timing, transitions, narration and BGM.
If it generates `route.md`, it must verify that file.
It verifies the route Markdown and source-linked asset references before handing off. A map
Directions line is inferred navigation, never a claimed recorded track.
See [geo production](geo-story-production.md).

## Every Markcut author verifies

**Any Agent creating or modifying a Markcut .md must run `markcut
verify <file>` on the current revision.** Editor also checks the
real source references, timings, narration/audio files, captions, transitions
and optional GPS integration via the Stage contract. A graphical player,
browser Preview and `editor-viewer.json` are not mandatory; however, Editor
**must examine actual source frames, source sound and rendered rough-cut
frames/audio** to judge story, orientation, cut boundaries and clarity.
Markcut syntax verification alone is not an artistic review. If the executing
Editor has no tool to genuinely listen, it must report subjective audio quality
**UNVERIFIED** (never PASS), use decode/level/silence checks and retain the
source audio. For a private film this does not block the **technical** Editor
handoff when real render, visual inspection, Markcut verify and Stage checks
all PASS. An unavailable listening capability is not a failed media asset.
Producer separately renders and probes the final MP4's video and audio streams.
Neither technical completion nor no-review mode authorizes public publishing.

## Optional Visioner / Director previews

The Stage acceptance columns above remain unchanged. Only explicitly
requested interactive modes create extra Review-only documents. Visioner
can generate `visioner-review.md` from its evidence and original approved
media, one source per Scene. Director can author `director-hooks.json` with
2–3 distinct stories and its recommended direction, then use the
project-local converter to produce `director-hooks.md`, with Guide and
recommendation shown in each Scene. These are private, generated Preview
views, not replacement contracts or extra DAG roles. Without opt-in, Director
produces only one story and neither extra MD is necessary.

The Review MD must pass `markcut verify`. `neo project review checkpoint`
validates the owning Stage and commits allowlisted text/MD within the Run's
**local-only Git**; this full SHA is the Event Review identity. Source and
media preview bytes remain ignored by Git, with the original source manifests
providing source provenance. Use the immutable current Relay Task template for
Event Preview; no fabricated identity. Review request ACK ≠ approval. Relay
suspends/resumes the current Stage; Stage-owned Agent consumes accepted
Scene/time comments, updates its original outputs and re-verifies.

## Preview, publishing and private tests

Producer interactive human `markcut preview` is optional and only sent when requested.
Its Event request receipt is not approval. If requested, the Producer waits
for the decision for that exact revision. Content-change feedback goes
back to Editor, whose changed files require fresh `markcut verify` and Stage checks.
Private archive does not depend on a final-review task.

Publisher requires **no interactive review**. It is conditional. Read [publication contract](vlog-publication.md).
No `publisher-request.json` means **SKIPPED** without browser writes.
Authorization must name target platform, verified account, action and exact
rendered MP4 fingerprint. Draft, reviewing, published and uncertain
are distinct results. Never duplicate an uncertain submission.

An explicit private `--no-review` render test uses
`review-mode.json` with `schemaVersion:1`, `mode:private-render-test`,
`reviewStatus:UNREVIEWED` and `publicationAllowed:false`.
This does not imply any external publishing authorization.

## Narration source policy (new Vlog Runs)

For Runs dated 2026-11-07 or later, Editor's synthesized Chinese voiceovers
come only from **Worknode ChatTTS male voice**. OpenVoice V2 conversion
requires an explicit Run-specific voice-cloning authorization. If the Run
forbids voice cloning, use unconverted generic male ChatTTS audio and do not
access a voice reference; do not weaken the Worknode provenance requirement.
Record the real Worknode `result.json` as
`assets/narration/chattts-male/worknode-result.json` with original generated
`.m4a` assets and duration-matched scene references. Stage validation rejects
local Tingting or unverified fallback and enforces legacy root BGM `volume:0.7` before 2026-11-09 and template-prepared root `volume:1.0` with permanent Brand-Intro after that date.
Original recorded speech and ambience are not synthetic narration and are
not substituted by ChatTTS. Existing earlier Runs retain historical voice provenance. Voice and soundtrack
rights must be cleared separately before commercial/public distribution.
