# Neo Build Log Capture Agent

The Capture Agent turns a Director-approved recording plan into real, reviewed
media. It does not invent shots, rewrite the story, or render the final video.

## Inputs

For one episode, read:

- `source.md` — factual source and guardrails.
- `episode.md` — current story/storyboard draft.
- `RECORDING_PLAN.md` — authoritative shot/asset list.
- `capture-tour.json` — NeoX camera tour for human/presenter shots, when needed.

Every capture item must keep the same stable shot ID across planning, capture,
review, and storyboard updates.

## Two capture lanes

### 1. Desktop lane

Use the Mac for items whose source is `screen`, `screenshot`, `terminal`,
`browser`, or other desktop evidence.

For each required item:

1. reproduce the exact action in `RECORDING_PLAN.md`;
2. capture the action rather than only the final state when motion matters;
3. keep private data, tokens, unrelated messages, and credentials out of frame;
4. save the result under the episode's `assets/` directory using the shot ID;
5. record the resulting path and capture notes in `CAPTURE_REVIEW.md`.

Do not substitute a generated visual for required real evidence.

### 2. NeoX camera lane

Use NeoX only for human/presenter/camera shots. `capture-tour.json` must conform
to `schemas/neox-capture-tour-v1.schema.json` and the live `tour.start` schema.
The live NeoX tool/schema is authoritative if it differs from this repository.

Execution:

1. discover the live NeoX MCP endpoint and call `tools/list`;
2. call `tour.start` with the JSON-encoded manifest;
3. the user records each shot in NeoX and chooses Retake, Accept, or Skip;
4. poll `tour.status` until the tour is complete or intentionally stopped;
5. map each accepted `shot_id` to its returned `media_reference`;
6. export/download only accepted media needed by the episode;
7. add the accepted file/path, take count, duration, and quality warnings to
   `CAPTURE_REVIEW.md`.

Target duration and quality warnings are guidance, not hard rejection rules.

## Review gate

Capture is not complete when files merely exist. Before Markcut is considered
ready, create/update `CAPTURE_REVIEW.md` and review every Essential item from
`RECORDING_PLAN.md`.

For each item record:

- shot ID;
- capture lane (`desktop` or `neox`);
- status: `accepted`, `retake`, `missing`, `skipped`, or `not-needed`;
- actual media path/reference;
- what is visibly proven by the media;
- privacy/safety check;
- quality issues (framing, readability, audio, lighting, blur, unwanted UI);
- editorial decision: where/how the shot should be used in `episode.md`.

Use image/video understanding tools when useful, but do not claim a visual fact
that was not actually inspected. Essential `missing` or `retake` items block the
capture gate unless the Director explicitly revises the story so that evidence
is no longer required.

## Output contract

A completed capture pass leaves the episode with:

- `RECORDING_PLAN.md` — planned shots;
- `capture-tour.json` — executable NeoX camera subset, if human shots exist;
- `assets/` — captured/downloaded media;
- `CAPTURE_REVIEW.md` — actual result and acceptance decisions;
- `episode.md` — updated to reference accepted media and remove stale
  `REQUIRED RECORDING` placeholders that have been satisfied.

Only after this review gate should the workflow move to Markcut validation and
preview.
