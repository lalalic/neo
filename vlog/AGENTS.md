# Vlog — project execution policy

Vlog turns real source-linked footage into one personal story-first episode,
with optional explicitly authorized publication. Use [graph.mmd](graph.mmd),
[stage contract](docs/episode-stage-contract.md) and
[publication contract](docs/vlog-publication.md). Relay manages Jobs,
Tasks and dependencies, not this project.

## Run boundary

Use `neo project run --path=/absolute/neo/vlog/runs/YYYY-MM-DD-episode --project=vlog`
on an existing private dated Run. iCloud watcher ingestion is separate.
Every stage works in the same ignored `runs/<episode>/`. A source manifest
and Visioner evidence must exist before writing the story.

## Private context and reusable media

- **Creator context (Director):** Read private project-root `user.md`
  before drafting. It informs everyday personality and tone, not filmed facts
  or automatic permission to reveal private details. Do not build a second profile.
- **Story history (Director):** Search the private, ignored
  `runs/.story-history/history-index.json` using
  `node scripts/story-history.mjs search [terms]`; `inspect RUN_ID` to
  read only relevant original Run stories. Validated Director and Producer
  stages update the index. Past episodes help continuity but cannot prove
  present footage. Missing/corrupt history is advisory, not a production gate.
- **Recorded personal library (Editor):** Private `assets/personal-library/`
  contains one `tour-director.json` used both to guide Tour recording
  (`tour-recordings.mjs manifest`) and index its accepted recordings.
  Start Tour using the JSON emitted by `manifest`; after `tour.status`
  reports an accepted take, download its original `/files/` media and call
  `tour-recordings.mjs archive` to update this same index atomically.
  Each recording file sits beside that JSON, never in per-Tour subfolders.
  `node scripts/tour-recordings.mjs list [--topics TOPIC]` returns only
  verified active takes. Empty library is normal. Historical inserts require
  relevant permission; old takes are not new footage or voice-clone consent.

## Stage ownership

- **Visioner** records real source IDs, timecodes and media observations,
  not creative fiction or repetitive inference. It calls native
  `markcut vision --normalize-only` to produce 360px video / 384px image
  inputs under `input/media/.normalized` and writes
  `vision-normalized-manifest.json`. Only these tiny copies should be
  passed to Vision Understanding; original footage and GPS stay authoritative
  for shot selection, timecodes and final render. Long clips are sampled
  for understanding, never reused as timeline footage.
- **Director** writes a complete first-person lived-experience story
  (curiosity/intent, exploration or action, discovery/result; real setbacks
  only when evidenced), source-linked shot plan and `route-intent.json`. Director chooses
  **if/why** to show the route, which filmed stops it represents, and
  describes its narrative purpose, not timeline mechanics.
- **Editor** owns the EDL, actual audio/media assets, `episode-input.json`,
  `music-plan.json`, and complete verified `video.md`. Editor
  decides **how** to merge the Director route into an executable map scene,
  its timing, narration, transitions and continuous BGM. **Any Agent
  creating or modifying Markcut .md must run `markcut verify`** on that
  exact revision before handoff. Editor does not need native playback,
  a browser, audio listening, or a Viewer receipt.
- **Producer Agent** uses its Shortcut to verify Editor's `video.md`,
  render an MP4, probe real audio/video and optionally call human Preview
  **only on demand**. Return content changes to Editor; never rewrite its
  story, clips or music. No separate Final QA or final review stage. Default DAG bypasses all interactive reviews; Producer may request one explicitly. Publisher has no review gate.
- **Publisher Agent** uses its Shortcut to publish to WeChat Channels
  and Xiaohongshu through installed WebHelm platform Actions. A missing
  `publisher-request.json` means no-op: no upload, draft or post.
  Explicit authorization must match finished MP4 fingerprint, named
  account and each target. Verify each platform-side status and receipt;
  never blindly retry uncertain submissions.

## Source, story, route and sound

A scenic-only montage is not a completed human story. Separate
observed/inferred/fictionalized claims, preserve real source evidence and
original timestamps. GPS is optional; without trustworthy coordinates
Director chooses omit, not invented movement. Directions geometry is
not an observed travelled track. Use
[Personal Story-first](docs/personal-story-first.md),
[story/route/sound](docs/story-first-route-sound.md), and
[geo production](docs/geo-story-production.md).
A single continuous **template-selected** BGM is standard; do not replace
missing chosen music with made-up tracks. Preserve useful original sound.
Public release must respect actual audio rights, private location and
per-account authorization.

## Execution speed target, not a deadline

For ordinary private Vlog generation, the Orchestrator should **aim to finish
within about 20 minutes** by reusing source indexes, using the existing
Markcut Vision-normalized inputs, running shortcut scripts first, avoiding
repeated model work, and resuming checkpointed artifacts. This is a quality
and efficiency goal **not a code-enforced timeout**. Never cancel or mark
an active Task failed solely because the elapsed wall clock reaches 20
minutes. A run continues while execution is healthy, with normal progress
and lease monitoring, recoverable errors, and explicit user cancellation.

## Handoffs and quality

Each Stage runs `node scripts/validate-stage.mjs <stage> <run>`.
Repair problems in the owning Agent, then re-verify the changed .md.
Editor runs Markcut verification and noninteractive Stage checks, not a real
player. Producer render success alone is not proof of decodable MP4 audio/video.
Browser click success alone is not proof of published content.
The executable `video.md` is the authority for the actual video;
all other artifacts are its evidence/inputs.

Maintain `.evals/cases.json` and run `neo eval run --project vlog`
where available, plus deterministic contract and no-post tests.
