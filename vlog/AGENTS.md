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

## Stage ownership

- **Visioner** records real source IDs, timecodes and media observations,
  not creative fiction or repetitive inference.
- **Director** writes a complete first-person goal/setback/actions/payoff
  story, source-linked shot plan and `route-intent.json`. Director chooses
  **if/why** to show the route, which filmed stops it represents, and
  describes its narrative purpose, not timeline mechanics.
- **Editor** owns the EDL, actual audio/media assets, `episode-input.json`,
  `music-plan.json`, complete `video.md`, and viewer self-check. Editor
  decides **how** to merge the Director route into an executable map scene,
  its timing, narration, transitions and continuous BGM. **Any Agent
  creating or modifying Markcut .md must run `markcut verify`** on that
  exact revision before handoff. Editor must actually view/listen to
  Markcut playback and save revision-bound `editor-viewer.json`.
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

## Handoffs and quality

Each Stage runs `node scripts/validate-stage.mjs <stage> <run>`.
Repair problems in the owning Agent, then re-verify the changed .md.
Parser PASS alone is not viewer evidence; real playback/seek/listening
matters. Render command success alone is not proof of a decodable MP4.
Browser click success alone is not proof of published content.
The executable `video.md` is the authority for the actual video;
all other artifacts are its evidence/inputs.

Maintain `.evals/cases.json` and run `neo eval run --project vlog`
where available, plus deterministic contract and no-post tests.
