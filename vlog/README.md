# Vlog

Produces a personal story from real, source-linked media and can post its
finished MP4 when explicitly authorized. Use `neo project run --path=/absolute/neo/vlog/runs/YYYY-MM-DD-episode --project=vlog`.
The canonical topology is [graph.mmd](graph.mmd). See the
[stage contract](docs/episode-stage-contract.md) and
[publisher contract](docs/vlog-publication.md).

## Workflow

```text
Visioner (source video/audio evidence)
  → Director (complete personal story, selected footage, route decision and description)
  → Editor (EDL, full video.md, audio/assets, route integration, markcut verify, static source/asset validation)
  → Producer Agent + Shortcut (verify, render MP4, probe, Preview on demand)
  → Publisher Agent + Shortcut (conditional authorized WeChat Channels/XHS publication)
```

Director writes the human goal/setback/actions/payoff before selecting shots.
Director decides **if/why** the route serves the narrative and which filmed
stops are verified. Editor decides **how** that route appears on the movie
(timeline, map animation, transition, sound) and verifies its source and asset references without opening a player.
A route is optional. A navigational route is not evidence of travelled track.

**Any Agent writing/revising a Markcut .md calls `markcut verify`.**
Editor does not require native playback or `editor-viewer.json`.
Producer re-verifies/renders without editorial changes.
There is no independent Final QA or mandatory final review. Optional owner
Preview is not publication authorization.

The chosen [Markcut template](templates/cinematic-vlog.md) is authoritative for
root BGM, aspect ratio, subtitles and transitions. Do not turn the episode
into a scenery-only montage, fake filmed locations or silently replace music.
Private artifacts stay in ignored `runs/<episode>/`. Visioner uses
Markcut Vision's existing `.normalized` files (360px video, 384px
still) for AI Vision Understanding; it records the original-to-normalized
identity mapping in `vision-normalized-manifest.json`. They are not
phone streaming files, and Editor/Producer must keep using original media.

Publisher requires `publisher-request.json` bound to the exact MP4,
account, target platform and authorized action. Otherwise no browser actions
occur. Reuse existing WebHelm `wechat-channels` and `xhs` Actions
rather than duplicating browser automation. Distinguish drafts, submitted
for review, published, and unknown outcomes, and do not retry uncertain posts.

## iCloud inbox watcher

The project exposes one lifecycle entrypoint:

```bash
./neo-project setup
./neo-project start
./neo-project status
./neo-project health
./neo-project restart
./neo-project stop
```

`uninstall` removes only the PM2 service and preserves private media and
`runs/`. Neo.app calls this entrypoint instead of owning watcher commands.
`setup` packages the watcher under ignored `runs/.service/`; `start`
uses the packaged runtime and PM2 boot persistence.

The optional watcher treats `manifest.json` as the producer's final-ready signal. A supported manifest is JSON with `schema_version: 1`, a safe `submission_id`, and a non-empty `media` array whose entries are either relative path strings or `{ "path": "..." }` objects. Media must be downloaded local regular files; missing, zero-byte, symlinked, absolute, or traversal paths are rejected.

The watcher moves a valid submission directory atomically into `runs/YYYY-MM-DD/HH/<submission-id>/input/` before creating one planner-backed Episode Job through Agents Relay. The Vlog-local Planner creates the ordered Task DAG; the watcher does not define an agentGraph. On restart it scans moved inputs first, so a crash after the move and before Task creation is recoverable without a local database. The Visioner stage Task uses `vlog-visioner-<submission_id>`; the Episode Job owns the overall outcome.

For a persistent process, package `vlog/` with `npm pack` and run the resulting `vlog-inbox-watcher` bin through the existing process supervisor via `npx --package <tarball> vlog-inbox-watcher` (do not point PM2 at a developer checkout). By default the watcher consumes Neox’s fixed app-owned iCloud inbox at `~/Library/Mobile Documents/iCloud~com~neox~app/Documents/Vlog Inbox`; `VLOG_ICLOUD_INBOX` remains an explicit override. Configure these deployment values: `VLOG_ICLOUD_INBOX`, `VLOG_RUNS_DIR`, `VLOG_RELAY_REPO`, `VLOG_RELAY_PR`, `VLOG_RELAY_JOB_ID`, and optionally `VLOG_RELAY_AGENT` and `VLOG_WATCH_INTERVAL_MS`. The watcher creates a normal model-backed Task without adapter/provider/model constraints, so Agents Relay performs the required worker-router then model-router selection. The project-local Planner reads `graph.mmd` to derive normal Stage Tasks; reviewers run inside Producer through the Relay Action, not separate Tasks.


## Route Story template

Route Story is a presentation template built on the Vlog source-truth contract. Use it when enough media contains reliable GPS/location evidence.

Flow: source media -> GPS + capture time -> stops / route segments -> movement recognition -> Chinese route overview/narration -> location/movement-aware story beats -> main photo/video edit -> route recap.

Movement recognition distinguishes at minimum walking/strolling, cycling, driving, and unknown. The contract owns truth, evidence, movement semantics, language defaults, audio requirements, and review gates. The template owns presentation: route opening, animated map/route cards, movement transitions, narration placement, and recap.

Generated titles, captions, route narration, chapter labels, and voiceover scripts default to Simplified Chinese unless the user explicitly requests another language.

## Audio and spoken edit commands

Every final Vlog includes BGM by default. Source it through shared audio-sourcing and mix/duck it under narration, dialogue, and useful original sound.

Source video may contain spoken editing control. Hey Neo is the default wake phrase: the following utterance becomes an edit-command candidate tied to its source clip/time range. Clear commands can keep/remove/emphasize/reorder material, preserve original sound, add text/narration, change pacing, or choose a transition. The wake phrase and command normally function as editing control data rather than final-story dialogue unless intentionally retained.

## Default visual style

For ordinary personal/travel Vlogs, default to a joyful, light, lively, energetic feel unless the source story calls for something else.

The result should not feel like a static slideshow. Real media stays the foundation, enhanced with purposeful animated route drawing, walking/cycling/driving graphics, parallax/photo motion, kinetic typography, playful graphic accents, beat-aware cuts and transitions, speed ramps/freeze frames when appropriate, and explanatory CG when useful.

Generated/CG material remains editorial/explanatory and must never be presented as real source footage.
