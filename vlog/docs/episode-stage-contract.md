# Vlog Episode Stages — canonical acceptance

[graph.mmd](../graph.mmd) is the one normal DAG. These are private
`runs/<episode>/` artifacts, not independent review Jobs. No independent
Final QA or mandatory Final Review is required; no human preview is
required for an ordinary private MP4.

| Stage | Output | Acceptance |
| --- | --- | --- |
| Source | `source-manifest.json` | Owner-authorized real evidence; `INPUT_NEEDED` blocks |
| Visioner | `vision-evidence.json`, source index | Real visuals/audio, timestamps and uncertainty |
| Director | `personal-story.md/json`, `story.md`, `shot-selection.json`, `visual-brief.md`, `post.md`, `route-intent.json` | Complete personal goal → setback → actions → payoff, verified source-linked stops or omit |
| Editor | `edit-decision-list.json`, assets, `episode-input.json`, `music-plan.json`, `video.md`, `editor-viewer.json` | All Markcut .md verified, real playback checked, audio/captions/transitions/route working |
| Producer | `output/video.mp4`, `production-receipt.json` | Verify again, render exact Editor revision, probe playable video **and audio**, Preview only on request |
| Publisher | `publish/<platform>-receipt.json` or SKIPPED | Separate explicit per-MP4, per-platform/account authorization and verified platform status |

## Route division

Director decides whether to include a geographical view and **describes
the route story** with real filmed source references and a desired
story beat. `route-intent.json` has `decision: include|omit`,
`reason`, and for inclusion `insertAfterStoryBeatId`, `narration`
and source-linked `observedStops`. An omitted route is a normal success.

Editor converts that narrative decision into `episode-input.geo`,
choosing the exact scene placement, geo/map subvideo, timing, transitions,
narration and BGM. If it generates a `route.md` it must verify that file.
It must watch/seek the route in the real viewer before handing off. A map
Directions line is inferred navigation, never a claimed recorded track.
See [geo production](geo-story-production.md).

## Every Markcut author verifies and views

**Any Agent creating or modifying a Markcut .md must run `markcut
verify <file>` on the current revision.** The Editor then uses native
Markcut viewer/player (not human event Preview) to watch opening, middle,
ending, shot boundaries and the optional map, and listen to audio.
Store `editor-viewer.json` with the actual `videoSha256`,
`status: PASS`, `checks: [opening,middle,ending,transitions,subtitles,audio]`
and `route` when applicable. Changed Markdown invalidates the viewer
record. Storyboard placeholders do not demonstrate sound or final frames.
Producer verifies and probes a real MP4 but never re-authors Markcut.

## Preview, publishing and private tests

Producer interactive human `markcut preview` is optional and only sent when requested.
Its Event request receipt is not approval. If requested, the Producer waits
for the decision for that exact revision. Content-change feedback goes
back to Editor, whose changed files require fresh verify/viewer evidence.
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
