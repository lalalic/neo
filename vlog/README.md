# Vlog

Vlog turns real daily media and evidence into one coherent short-form story and verified publication outcome. It is a thin Neo content project: Vlog owns the editorial/production contract; Agents Relay owns orchestration; shared Neo capabilities own reusable media, vision, rendering, and publishing implementation.

## Human mental model

This chart is the primary architecture asset for understanding Vlog.

```text
                         NEO VLOG

              ┌──────────────────────┐
              │ Autonomous Vlog Job  │
              └──────────┬───────────┘
                         │
                         v
              ┌──────────────────────┐
              │ ONE Episode Task     │
              │ YYYY-MM-DD[-slug]    │
              └──────────┬───────────┘
                         │
                         v
              ┌──────────────────────┐
              │ Real Source Media    │
              │ photos / video/audio │
              └──────────┬───────────┘
                         │
                         v
              ┌──────────────────────┐
              │ Story + Visual Brief │
              │ hook / arc / payoff  │
              └──────────┬───────────┘
                         │
                         v
              ┌──────────────────────┐
              │ Production Draft     │
              │ video.md + assets    │
              │ sound / motion       │
              └──────────┬───────────┘
                         │
                 ┌───────┴────────┐
                 │                │
                 v                v
        ┌────────────────┐  ┌────────────────┐
        │ Video Director │  │ Market Agent   │
        │ Review         │  │ Review         │
        └───────┬────────┘  └───────┬────────┘
                │                   │
                └─────────┬─────────┘
                          │
                    BOTH PASS
                          │
                          v
              ┌──────────────────────┐
              │ Final Render + QA    │
              └──────────┬───────────┘
                         │
                         v
              ┌──────────────────────┐
              │ Authorized Publish   │
              │ + platform receipt   │
              └──────────────────────┘
```

The durable unit is the **episode**, not each production phase. One episode is one top-level Task; normal source selection, story, edit planning, rendering, QA, and publishing live inside its agentGraph.

## Ownership map

```text
┌──────────────────────────────┐
│ vlog                         │
│                              │
│ real-media story contract    │
│ episode hook / arc / quality │
│ vlog-editor / vlog-producer  │
└──────────────┬───────────────┘
               │
               v
┌──────────────────────────────┐
│ Agents Relay                 │
│                              │
│ Job / Task / agentGraph      │
│ retry / routing / events     │
│ leases / reconcile / recover │
└──────────────┬───────────────┘
               │
               v
┌──────────────────────────────┐
│ Shared Neo capabilities      │
│                              │
│ phone media / vision         │
│ Video + Execution Director   │
│ image/video/audio / Markcut  │
│ Market / post / QA           │
└──────────────────────────────┘
```

Vlog does not own a scheduler, database, worker launcher, routing policy, model policy, browser publisher, media engine, or lifecycle state machine.

## Episode artifact flow

`visual-brief.md` is the primary creative handoff for downstream production. `video.md` is the canonical executable Markcut source.

```text
real phone/media evidence
        │
        v
source-manifest.json
        │
        v
story.md
        │
        v
visual-brief.md        <-- creative direction
        │
        ├── hook / story beats
        ├── selected source media
        ├── visual treatment
        ├── motion / transitions
        └── sound / narration intent
        │
        v
video.md               <-- canonical Markcut source
        │
        v
execution/ + assets/
        │
        v
reviews/
        │
        v
final video + QA
        │
        v
publish receipt
```

Normal run layout:

```text
runs/<YYYY-MM-DD[-slug]>/
├── source-manifest.json
├── story.md
├── post.md
├── visual-brief.md
├── video.md
├── execution/
├── assets/
├── reviews/
│   ├── video-director.md
│   └── market.md
├── output/
├── qa.md
└── publish/
```

A genuine named series may use `runs/<series-name>/<YYYY-MM-DD[-slug]>/`. `runs/` is ignored by Git.

## Story standard

A Vlog is not a chronological media dump. Select one coherent story from the real source window:

```text
HOOK
  ↓
Moment / Tension / Question
  ↓
Development / Discovery
  ↓
Best visual evidence
  ↓
Payoff / feeling / next question
```

Do not widen the source window or fabricate events just to create a story.

## Production quality

Original footage and useful original sound are first-class assets. Narration is optional; when narration is used, use the user's approved voice identity rather than silently substituting generic TTS. BGM is mandatory by default and must support rather than cover dialogue, narration, and meaningful original sound; SFX remain intentional.

Use strong visual composition, purposeful cuts, charts/diagrams/images when they genuinely explain something, kinetic typography when useful, and deliberate motion/transitions/effects. Do not turn real-life footage into a static slideshow unless the story calls for it.

Final render requires both Video Director and Market Agent review to pass. Observable QA must check the actual video, not only render exit status.

## Publication

Publication platform and authorization belong to the active Agents Relay Job/Task. Vlog uses the shared `post-agent` and persists platform-side receipt/status. The project itself does not hard-code a platform.

See `AGENTS.md` for the enforceable Planner/execution contract.

## iCloud inbox watcher

The optional watcher treats `manifest.json` as the producer's final-ready signal. A supported manifest is JSON with `schema_version: 1`, a safe `submission_id`, and a non-empty `media` array whose entries are either relative path strings or `{ "path": "..." }` objects. Media must be downloaded local regular files; missing, zero-byte, symlinked, absolute, or traversal paths are rejected.

The watcher moves a valid submission directory atomically into `runs/YYYY-MM-DD/HH/<submission-id>/input/` before creating exactly one episode Task through Agents Relay. On restart it scans moved inputs first, so a crash after the move and before Task creation is recoverable without a local database. Relay task identity is `vlog-episode-<submission_id>`.

For a persistent process, package `vlog/` with `npm pack` and run the resulting `vlog-inbox-watcher` bin through the existing process supervisor via `npx --package <tarball> vlog-inbox-watcher` (do not point PM2 at a developer checkout). By default the watcher consumes Neox’s fixed app-owned iCloud inbox at `~/Library/Mobile Documents/iCloud~com~neox~app/Documents/Vlog Inbox`; `VLOG_ICLOUD_INBOX` remains an explicit override. Configure these deployment values: `VLOG_ICLOUD_INBOX`, `VLOG_RUNS_DIR`, `VLOG_RELAY_REPO`, `VLOG_RELAY_PR`, `VLOG_RELAY_JOB_ID`, and optionally `VLOG_RELAY_AGENT` and `VLOG_WATCH_INTERVAL_MS`. The watcher creates a normal model-backed Task without adapter/provider/model constraints, so Agents Relay performs the required worker-router then model-router selection. The Task carries the canonical Vlog episode agent graph `vlog-editor -> vlog-producer`; the producer contract owns the required Video Director and Market review gate plus render/QA and authorized publication.


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
