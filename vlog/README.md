# Vlog

Vlog turns real daily media and evidence into one coherent short-form story and verified publication outcome. It is a thin Neo content project: Vlog owns the editorial/production contract; Agents Relay owns orchestration; shared Neo capabilities own reusable media, vision, rendering, and publishing implementation.

See [the reusable stage input/output and review contract](docs/episode-stage-contract.md) for Source → optional Research → Story → Production → immutable Preview Review → technical QA → archive/explicit Publish Authorization. GPS is optional; owner-approved real media is required before creating an actual Episode Task.

The **only authoritative Episode Graph** is [graph.mmd](graph.mmd). Every episode starts internally with Visioner (shared media understanding and metadata extraction), followed by an optional human evidence review, then Director shot/story selection, Editor cut decisions, Producer-owned professional reviews, render/QA and private archive. Publication remains separately authorized. Watcher/ingress is outside the Episode Graph. The simplified flow below is explanatory only; Planner must use the canonical Graph and acceptance gates.

For authentic personal narratives, the Story editor can use an optional [five-question audience familiarity review](docs/story-familiarity-review.md) (real situation, inner thoughts, familiar voice, audience takeaway, information density). It must cite source evidence or owner confirmation and never fabricate internal experiences.

## Stage-by-stage owner reviews

Run the private review UI against the canonical `vlog/runs/<episode>` tree,
not a temporary Relay worktree:

```sh
node scripts/stage-review.mjs serve --stage visioner --run /absolute/path/to/vlog/runs/<episode>
node scripts/stage-review.mjs status --stage visioner --run /absolute/path/to/vlog/runs/<episode>
```

The stages `visioner`, `director`, and `editor` have source evidence,
storyboard, and timeline views respectively. Each comment is tied to the
source/shot/time and immutable artifact revision, and the Stage Worker
records how it revised the artifact before requesting another review.
`producer` feedback is supplementary; the required rendered-video
approval still uses `neo.markcut_preview`. The local page is only exposed
on loopback, not to remote users without an authorized access path.
Opening a page is not human feedback or approval. See
[Stage review protocol](docs/episode-stage-contract.md#stage-specific-review-and-correction-protocol).

## Human mental model

```text
Watcher -> Visioner -> Director -> Editor -> Producer -> Final QA -> Private archive
             |          |          |
         evidence     story       timeline    Markcut CLI + Relay review run
                                   | generic Outcome Reviewer
                                   + Video Director
                                   + Market
                                   + Producer repairs and re-reviews
```

One Episode Job owns the objective. The first Plan creates all normal Graph
Stage Tasks; dependencies hold downstream work until prerequisites pass.
Validation, professional review and self-repair stay inside the owning Agent's Worker. The final published state still requires an
independent owner authorization.

## Ownership map

```text
┌──────────────────────────────┐
│ vlog                         │
│                              │
│ real-media story contract    │
│ episode hook / arc / quality │
│ Director / Editor / Producer │
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

## Optional location enrichment

```text
Authorized photos/video/audio -> story (hook / development / payoff) -> visual brief
              |
              +-> optional EXIF/QuickTime GPS check
                         | no trusted GPS -> no map scene (normal complete Vlog)
                         | partial GPS -> only verified stops, no guessed movements
                         + two+ approved points -> optional short map/scenic insert
```

GPS must never gate an episode. Raw coordinates stay private; a redacted route is included only with explicit disclosure approval. Maps show location context or inferred navigation, not a recorded travel track. Mandatory authorized BGM, original sound, Chinese defaults, revision-specific preview, both reviews and the no-publication-unless-authorized rule remain unchanged.

## Episode artifact flow

`visual-brief.md` is the primary creative handoff for downstream production. `video.md` is the canonical executable Markcut source.

```text
real phone/media evidence
        │
        v
source-manifest.json
        │
        v
vision-evidence.json
        │
        v
shot-selection.json + story.md
        │
        v
visual-brief.md        <-- Director creative direction
        │
        ├── hook / story beats
        ├── selected source media
        ├── visual treatment
        ├── motion / transitions
        └── sound / narration intent
        │
        v
edit-decision-list.json <-- Editor exact cuts
        │
        v
video.md               <-- Producer canonical Markcut source
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
├── vision-evidence.json
├── vision-human-review.json    # optional; records skip/request/response and provenance
├── source-manifest.json
├── story.md
├── shot-selection.json
├── edit-decision-list.json
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

Producer calls `agents-relay review run` with an outcome Prompt; generic, Video Director and Market reviews must all PASS before Producer can complete. Observable QA must check the actual video, not only render exit status.

## Publication

Publication platform and authorization belong to the active Agents Relay Job/Task. Vlog uses the shared `post-agent` and persists platform-side receipt/status. The project itself does not hard-code a platform.

See `AGENTS.md` for the enforceable Planner/execution contract.

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
