# Moments Book Architecture

## One memoir, two renderers

```mermaid
flowchart LR
  A[phone-harness<br/>Own WeChat Moments] --> B[Capture evidence]
  B --> C[Normalize + dedupe]
  C --> D[Canonical manifest]
  E[Original phone media] --> F[Media matcher]
  F --> D
  D --> G[Book renderer]
  D --> H[Markcut compiler]
  H --> I[One memoir video]
```

The manifest is the contract boundary. Extraction may evolve independently from
book and video presentation as long as the manifest remains valid.

Baseline capture is intentionally weaker than original-media enrichment: phone-harness captures the iPhone Mirroring window, so those assets are display-derived evidence. See baseline-media-extraction.md for still/video strategies, measurable capture properties, and the A/B/C/D capability matrix.

## Data model

At minimum a run manifest contains:

- memoir identity and source type;
- extraction window and discovered year ordering;
- years containing Moments;
- each Moment's stable run-local ID, posted date/text, source evidence,
  location text, and ordered media references;
- each media item's original-match state, capture timestamp, GPS metadata, and
  confidence/evidence.

GPS semantics are strict:

- `gps.status=observed`: coordinates came from original media metadata;
- `gps.status=missing`: metadata was checked and no coordinates were present;
- `gps.status=unknown`: original metadata was not available or not checked.

Provenance claims carry evidence: a matched original requires an asset
reference, confidence, and matching evidence; observed GPS requires the
coordinate source and matched original media. Years are ordered newest first,
and known Moments within each year are ordered newest first with timezone-aware
timestamps.

Human-readable location text from WeChat or prose inference is stored
separately and never promoted to observed coordinates.

## Latest-two-year selection

The first E2E run discovers year boundaries by scrolling the user's own Moments
album. Select the first two distinct calendar years that contain extractable
Moments. Do not assume the current calendar year has posts.

The collector should save checkpoints frequently enough that phone disconnects
do not require restarting the scan.

## Markcut parent/sub design

Markcut heading depth is the hierarchy:

```markdown
# video
width:1920 height:1080 fps:30 layout:series

## year-2026
title:"2026"

### moment-2026-04-18-001
- image src:./media/2026/001.jpg isBackground:true
- script "Moment narration"

### moment-2026-02-02-002
- video src:./media/2026/002.mov

## year-2025
title:"2025"

### moment-2025-12-31-001
- image src:./media/2025/001.jpg isBackground:true
- script "Moment narration"
```

This yields one complete video with year-level parent scenes and Moment-level
sub-scenes. A year can later be previewed/recomposed as a subtree without
changing the memoir's canonical chronology.

## Book structure

The book mirrors the same hierarchy:

```text
Memoir
├── Year
│   ├── Moment: date / text / media / place
│   └── Moment
└── Year
```

Presentation may add chapter intros, maps, or captions, but it must not reorder
or silently rewrite source Moments without recording the editorial transform.

## Privacy boundary

Tracked Git content contains schemas, templates, reusable scripts, and
documentation only. Private runtime evidence includes:

- WeChat screenshots and OCR output;
- usernames/account identifiers;
- Moment text when it belongs to a real user;
- photos/videos;
- EXIF/QuickTime metadata and GPS coordinates;
- rendered personal books/videos.

All such content belongs under `moments-book/runs/` and must never be committed.

## Failure and resume semantics

Phone-harness connection failures are external blockers. Preserve the current
checkpoint and resume when the phone is reachable. Never busy-loop a Connect
screen and never erase partial extraction as a recovery strategy.
