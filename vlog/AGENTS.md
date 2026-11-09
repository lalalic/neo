# Vlog — project execution policy

Vlog turns real source-linked footage into one personal story-first episode,
with optional explicitly authorized publication. Use [graph.mmd](graph.mmd),
[stage contract](docs/episode-stage-contract.md) and
[publication contract](docs/vlog-publication.md). Relay manages Jobs,
Tasks and dependencies, not this project.

The shared public content positioning and six episode directions live in
[channel.md](channel.md). From 2026-11-09 onward, every new Director story
selects at least one source-backed direction. Historical Runs remain unchanged.

## Local service lifecycle

`neo-project` owns the iCloud Inbox watcher lifecycle using PM2 against
`vlog/scripts/vlog-inbox-watcher.mjs` and imported `vlog/lib/` modules directly.
`setup` verifies local sources; `restart` reloads them. Do not package
`.tgz` or copy a secondary runtime under `runs/.service/`. The `runs/`
tree is for private episodes and ignored state, not duplicated executable
source. A watcher migration must preserve recorded Run and Inbox media.

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
- **Capture Tour (Director or Editor):** Load project-local
  [Vlog Tour Skill](skills/tour/SKILL.md) when real speech/video is needed.
  `Neo.app` records on Mac; `Neo Mobile` records on iPhone. The private
  `assets/personal-library/tour-director.json` is **both** the Tour recording
  guide and index of accepted media, stored beside that JSON with descriptive
  filenames and actual-clip `title`/`description` for Editor selection.
  Discover and call the connected device's Tour tools; there is no separate
  Tour CLI, manifest, catalog or index. An empty library never blocks editing.
  Only verified accepted takes can be used, and past recordings cannot be
  presented as new footage or reused publicly without authorization.

## Stage ownership

- **Visioner** records real source IDs, timecodes and media observations,
  not creative fiction or repetitive inference. It calls native
  `markcut vision --normalize-only` to produce 360px video / 384px image
  inputs under `input/media/.normalized` and writes
  `vision-normalized-manifest.json`. Only these tiny copies should be
  passed to Vision Understanding; original footage and GPS stay authoritative
  for shot selection, timecodes and final render. Long clips are sampled
  for understanding, never reused as timeline footage.
- **Director** writes a complete first-person lived-experience story about **给生活加点料**
  (curiosity/intent, exploration or action, discovery/result; setback optional), source-linked shot plan and `route-intent.json`. Director chooses
  **if/why** to show the route, which filmed stops it represents, and
  describes its narrative purpose and source-backed Canadian context for
  viewers in China, not timeline mechanics.
- **Visioner / Director optional Interactive Review:** absent an explicit
  per-Stage request, both proceed noninteractively and Director generates one
  story. An owner-supplied private `review-stages.json` may opt in with
  `{"visioner":true,"director":true}` (either stage independently), or the
  current Task can explicitly request one. Visioner uses
  `scripts/visioner-review-to-md.mjs` (each source → Scene); Director creates
  2–3 contrasting Hooks only when requested and uses
  `scripts/director-hooks-to-md.mjs` (each Hook → Scene, best recommended).
  Guide is visibly included in Scene preview. JSON/evidence contracts remain
  authoritative; Markcut MD is only a generated private Review view. Relay
  manages event-bound decision and resume; no new DAG nodes and no changes
  to Markcut/Relay. Read [review workflow](docs/stage-interactive-review.md).
- **Editor** owns the EDL, actual audio/media assets, `episode-input.json`,
  `music-plan.json`, and complete verified `video.md`. Editor
  decides **how** to merge the Director route into an executable map scene,
  its timing, narration, transitions and continuous BGM. **Any Agent
  creating or modifying Markcut .md must run `markcut verify`** on that
  exact revision before handoff. Editor must privately inspect real source
  frames and audio and inspect the rendered draft's visuals/sound before
  claiming quality. A graphical player, human Preview and Viewer receipt
  are optional; real visual/audio checks are not. If the Agent cannot
  genuinely listen to audio, **do not claim it did**: label subjective sound
  quality UNVERIFIED, perform real audio decode/level/silence diagnostics,
  and allow technically verified **private** Editor delivery. Reserve
  FAILED for actual technical/content failures, not lack of ears.
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
within about 20 minutes** by reusing Markcut metadata, using the existing
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

**Primary Neo Project acceptance:** evaluate every Agent in `graph.mmd` with
`neo eval run --project vlog --dag`. Use `--dag --smoke` for one real model
decision per DAG Agent and `--dry-run` only to verify prompt assembly.
The Eval Runner uses Relay's graph parser and real managed Worker prompts;
case coverage alone is not a PASS. Keep `.evals/cases.json` up to date.
Use targeted deterministic tests for source evidence, Stage contracts and
no-post safety; Relay owns generic DAG and Shortcut Runner tests.
